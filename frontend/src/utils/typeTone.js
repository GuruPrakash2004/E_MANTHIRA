// Display tone for the Nth value of a list that comes from the database (attendance types, ...). Purely styling: the
// colour follows the position in the list, never what the value means, so no meaning is built into the screen.
const TONES = ['green', 'orange', 'red', 'gold', 'kumkum', 'gray']

export const toneColor = (i) => TONES[i % TONES.length]
export const toneBg = (i) => `var(--mantine-color-${toneColor(i)}-1)`
