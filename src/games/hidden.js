// დამალული ხელის თამაშები (კარტი, დომინო): ეს ფაილი ძრავებს არ ტვირთავს, ამიტომ აპის გაშვებისას
// თამაშის მთელი კოდი არ ჩამოიტვირთება — მხოლოდ თამაშის გვერდზე.
export const HIDDEN = new Set(['domino', 'durak', 'joker', 'bura'])

// კლიენტზე: საჯარო მდგომარეობას ჩემს ხელს ვუმატებთ
export function withMyHand(type, state, seat, tiles) {
  if (!HIDDEN.has(type) || !seat || !tiles) return state
  return { ...state, hands: { ...state.hands, [seat]: tiles } }
}
