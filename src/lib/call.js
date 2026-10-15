// 1:1 ზარი WebRTC-ით. მდგომარეობები: ringing → connecting → active → ended
// mzera-ს გამოცდილება: მკაცრი მდგომარეობის მანქანა (desync-ის თავიდან ასაცილებლად),
// TURN სერვერი მობილური ქსელებისთვის და 40 წამიანი ზარის ლოდინი.
import { api } from './api.js'

export const RING_TIMEOUT = 40_000

export function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  const turn = import.meta.env.VITE_TURN_URLS
  if (turn) {
    list.push({
      urls: turn.split(',').map((u) => u.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    })
  }
  return list
}

const NEXT = {
  ringing: ['connecting', 'ended'],
  connecting: ['active', 'ended'],
  active: ['ended'],
  ended: [],
}

export class CallSession {
  constructor({ call, role, onChange }) {
    this.call = call
    this.role = role // 'caller' | 'callee'
    this.onChange = onChange
    this.state = 'ringing'
    this.reason = null
    this.local = null
    this.remote = null
    this.muted = false
    this.cameraOff = call.kind === 'audio'
    this.facing = 'user'
    this.startedAt = null
    this.pc = null
    this.chan = null
    this.pendingIce = []
    this.timers = []
    this.offs = []
    this.restarted = false
  }

  emit() { this.onChange?.(this) }

  set(state, reason = null) {
    if (this.state === state || !NEXT[this.state].includes(state)) return false
    this.state = state
    if (reason) this.reason = reason
    if (state === 'active') this.startedAt = Date.now()
    this.emit()
    return true
  }

  async media() {
    const video = this.call.kind === 'video' ? { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false
    this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video })
    this.emit()
  }

  // ---------------- დამრეკი
  async startAsCaller() {
    try { await this.media() } catch { this.end('nomedia', true); return }
    if (this.call.simulated) return this.simulate()
    this.chan = await api.callChannel(this.call.id)
    this.offs.push(this.chan.onMessage((m) => this.handle(m)))
    this.offs.push(api.onCallChange(this.call.id, (c) => {
      if (['declined', 'busy', 'missed', 'ended'].includes(c.status)) this.end(c.status, false)
    }))
    this.timers.push(setTimeout(() => {
      if (this.state === 'ringing') { api.updateCall(this.call.id, 'missed').catch(() => {}); this.end('missed', false) }
    }, RING_TIMEOUT))
  }

  // დემო რეჟიმი, როცა მეორე მხარე არ არის: საკუთარი ვიდეო „მოპირდაპირედ“
  simulate() {
    this.timers.push(setTimeout(() => {
      if (this.state !== 'ringing') return
      this.set('connecting')
      this.timers.push(setTimeout(() => {
        this.remote = this.local
        this.set('active')
      }, 700))
    }, 1800))
  }

  // ---------------- პასუხისმგებელი
  watchIncoming() {
    this.offs.push(api.onCallChange(this.call.id, (c) => {
      if (this.state === 'ringing' && ['missed', 'ended', 'declined'].includes(c.status)) this.end('missed', false)
      else if (c.status === 'ended') this.end('ended', false)
    }))
    this.timers.push(setTimeout(() => { if (this.state === 'ringing') this.end('missed', false) }, RING_TIMEOUT + 2000))
  }

  async accept() {
    if (this.state !== 'ringing') return
    this.set('connecting')
    try { await this.media() } catch { api.updateCall(this.call.id, 'declined').catch(() => {}); this.end('nomedia', false); return }
    await api.updateCall(this.call.id, 'accepted').catch(() => {})
    this.chan = await api.callChannel(this.call.id)
    this.offs.push(this.chan.onMessage((m) => this.handle(m)))
    this.createPeer()
    this.chan.send('ready', {})
    this.timers.push(setTimeout(() => { if (this.state === 'connecting') this.hangup('failed') }, 30_000))
  }

  async decline() {
    if (this.state !== 'ringing') return
    await api.updateCall(this.call.id, 'declined').catch(() => {})
    this.end('declined', false)
  }

  // ---------------- სიგნალები
  createPeer() {
    if (this.pc) return this.pc
    const pc = new RTCPeerConnection({ iceServers: iceServers() })
    this.pc = pc
    for (const t of this.local.getTracks()) pc.addTrack(t, this.local)
    pc.onicecandidate = (e) => { if (e.candidate) this.chan.send('ice', e.candidate.toJSON()) }
    pc.ontrack = (e) => {
      this.remote = e.streams[0] || new MediaStream([e.track])
      this.emit()
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') this.set('active')
      if (s === 'failed') this.restartIce()
      if (s === 'disconnected') {
        this.timers.push(setTimeout(() => { if (pc.connectionState === 'disconnected') this.restartIce() }, 4000))
      }
    }
    return pc
  }

  async restartIce() {
    if (this.restarted || this.role !== 'caller' || this.state === 'ended') {
      if (this.state !== 'ended' && this.pc?.connectionState === 'failed') this.hangup('failed')
      return
    }
    this.restarted = true
    try {
      const offer = await this.pc.createOffer({ iceRestart: true })
      await this.pc.setLocalDescription(offer)
      this.chan.send('offer', this.pc.localDescription.toJSON())
    } catch { this.hangup('failed') }
  }

  async handle({ type, payload }) {
    if (this.state === 'ended') return
    try {
      if (type === 'ready' && this.role === 'caller') {
        this.set('connecting')
        const pc = this.createPeer()
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        this.chan.send('offer', pc.localDescription.toJSON())
      } else if (type === 'offer' && this.role === 'callee') {
        const pc = this.createPeer()
        await pc.setRemoteDescription(payload)
        await this.flushIce()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.chan.send('answer', pc.localDescription.toJSON())
      } else if (type === 'answer' && this.role === 'caller') {
        await this.pc.setRemoteDescription(payload)
        await this.flushIce()
      } else if (type === 'ice') {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(payload)
        else this.pendingIce.push(payload)
      } else if (type === 'hangup') {
        this.end('ended', false)
      }
    } catch (e) {
      console.warn('call signal', type, e)
    }
  }

  async flushIce() {
    const list = this.pendingIce
    this.pendingIce = []
    for (const c of list) await this.pc.addIceCandidate(c).catch(() => {})
  }

  // ---------------- მართვა
  toggleMute() {
    this.muted = !this.muted
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !this.muted })
    this.emit()
  }

  toggleCamera() {
    if (this.call.kind !== 'video') return
    this.cameraOff = !this.cameraOff
    this.local?.getVideoTracks().forEach((t) => { t.enabled = !this.cameraOff })
    this.emit()
  }

  async flipCamera() {
    if (this.call.kind !== 'video' || !this.local) return
    this.facing = this.facing === 'user' ? 'environment' : 'user'
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing } })
      const track = s.getVideoTracks()[0]
      const old = this.local.getVideoTracks()[0]
      const sender = this.pc?.getSenders().find((x) => x.track?.kind === 'video')
      await sender?.replaceTrack(track)
      if (old) { this.local.removeTrack(old); old.stop() }
      this.local.addTrack(track)
      this.emit()
    } catch { /* მეორე კამერა არ არის */ }
  }

  hangup(reason = 'ended') {
    if (this.state === 'ended') return
    this.chan?.send('hangup', {})
    api.updateCall(this.call.id, 'ended').catch(() => {})
    this.end(reason, false)
  }

  end(reason, notify) {
    if (this.state === 'ended') return
    if (notify) api.updateCall(this.call.id, 'ended').catch(() => {})
    this.duration = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0
    this.timers.forEach(clearTimeout)
    this.offs.forEach((off) => off?.())
    this.pc?.close()
    this.local?.getTracks().forEach((t) => t.stop())
    this.chan?.close()
    this.set('ended', reason)
  }
}
