import { forwardRef } from 'react'
import { DateInput as MantineDateInput, DatePickerInput as MantineDatePickerInput } from '@mantine/dates'
import { DATE_FORMAT, parseTypedDate } from '../../utils/dateRange'

/**
 * The app's date fields. Every screen imports these instead of @mantine/dates, so every date is shown as 26-Oct-2026,
 * has the calendar to pick from, and (DateInput) can also be typed as 26-Oct-2026, 26/10/2026 or 26-10-2026.
 */
export const DateInput = forwardRef(function DateInput(props, ref) {
  return <MantineDateInput ref={ref} valueFormat={DATE_FORMAT} placeholder={DATE_FORMAT} dateParser={parseTypedDate} {...props} />
})

export const DatePickerInput = forwardRef(function DatePickerInput(props, ref) {
  return <MantineDatePickerInput ref={ref} valueFormat={DATE_FORMAT} placeholder={DATE_FORMAT} {...props} />
})
