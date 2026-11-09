import { forwardRef } from 'react'
import dayjs from 'dayjs'
import { DateInput as MantineDateInput, DatePickerInput as MantineDatePickerInput } from '@mantine/dates'
import { DATE_FORMAT, parseTypedDate } from '../../utils/dateRange'

/**
 * The app's date fields. Every screen imports these instead of @mantine/dates, so every date is shown as 26-Oct-2026,
 * has the calendar to pick from, and (DateInput) can also be typed as 26-Oct-2026, 26/10/2026 or 26-10-2026.
 * Every calendar marks today's cell (theme/global.css) and shows "Today: Monday, 09/11/2026" under the month grid.
 */

// The footer text lives in a CSS variable (a pseudo-element under the calendar prints it); it is renewed at midnight, so a tab left
// open overnight still shows the right day.
function publishToday() {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--vt-today-text', `"Today: ${dayjs().format('dddd, DD/MM/YYYY')}"`)
}
if (typeof window !== 'undefined' && !window.__vtTodayTimer) {
  const tick = () => {
    publishToday()
    window.__vtTodayTimer = setTimeout(tick, dayjs().add(1, 'day').startOf('day').diff(dayjs()) + 1000)
  }
  tick()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && publishToday())
}

export const DateInput = forwardRef(function DateInput(props, ref) {
  return <MantineDateInput ref={ref} valueFormat={DATE_FORMAT} placeholder={DATE_FORMAT} dateParser={parseTypedDate} highlightToday {...props} />
})

export const DatePickerInput = forwardRef(function DatePickerInput(props, ref) {
  return <MantineDatePickerInput ref={ref} valueFormat={DATE_FORMAT} placeholder={DATE_FORMAT} highlightToday {...props} />
})
