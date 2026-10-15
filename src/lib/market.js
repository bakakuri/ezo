// ბაზრის საერთო ცნობარი: კატეგორიები, ქალაქები, ფასის ფორმატი

export const CATEGORIES = [
  { key: 'electronics', label: 'ელექტრონიკა', icon: 'laptop', hue: '#3a6df0' },
  { key: 'vehicles', label: 'ავტომობილები', icon: 'car', hue: '#0f9d8a' },
  { key: 'realty', label: 'უძრავი ქონება', icon: 'building', hue: '#9a5b2e' },
  { key: 'home', label: 'სახლი და ბაღი', icon: 'sofa', hue: '#c77d12' },
  { key: 'fashion', label: 'ტანსაცმელი', icon: 'shirt', hue: '#df1f52' },
  { key: 'kids', label: 'საბავშვო', icon: 'balloon', hue: '#d9468f' },
  { key: 'hobby', label: 'ჰობი და სპორტი', icon: 'ball', hue: '#4f9a1c' },
  { key: 'animals', label: 'ცხოველები', icon: 'paw', hue: '#a0632a' },
  { key: 'services', label: 'მომსახურება', icon: 'wrench', hue: '#6d4ad8' },
  { key: 'other', label: 'სხვა', icon: 'box', hue: '#5b6478' },
]
export const categoryOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1]

// მდგომარეობა აზრი აქვს მხოლოდ ნივთებს
export const HAS_CONDITION = new Set(['electronics', 'vehicles', 'home', 'fashion', 'kids', 'hobby', 'other'])
export const CONDITIONS = { new: 'ახალი', used: 'მეორადი' }
export const STATUS = { active: 'აქტიური', reserved: 'დაჯავშნილია', sold: 'გაიყიდა' }

export const CITIES = [
  'თბილისი', 'ბათუმი', 'ქუთაისი', 'რუსთავი', 'გორი', 'ზუგდიდი', 'ფოთი', 'თელავი', 'ქობულეთი', 'ხაშური',
  'სამტრედია', 'ზესტაფონი', 'მარნეული', 'ახალციხე', 'ოზურგეთი', 'ბორჯომი', 'მცხეთა', 'სიღნაღი', 'ამბროლაური', 'მესტია',
]

export const SORTS = [['new', 'ახალი'], ['cheap', 'იაფიდან'], ['expensive', 'ძვირიდან']]

export const MAX_PHOTOS = 8

const group = (n) => {
  const whole = Number.isInteger(n)
  const [a, b] = (whole ? String(n) : n.toFixed(2)).split('.')
  const g = a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return b ? `${g}.${b}` : g
}

// „1 250 ₾“, „$900“, „უფასოდ“, „ფასი შეთანხმებით“
export function priceText(price, currency = 'GEL', { short = false } = {}) {
  if (price === null || price === undefined || price === '') return short ? 'შეთანხმებით' : 'ფასი შეთანხმებით'
  const n = Number(price)
  if (n === 0) return 'უფასოდ'
  return currency === 'USD' ? `$${group(n)}` : `${group(n)}\u00a0₾`
}

export const QUICK_QUESTIONS = ['ჯერ კიდევ იყიდება?', 'ბოლო ფასი რა არის?', 'სად შეიძლება ნახვა?', 'მიწოდება გაქვთ?']
