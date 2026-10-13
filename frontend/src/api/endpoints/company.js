import { api, del, download, get, post, put } from '../api'

export const getCompanyLayout = () => get('/company/layout')
export const getCompany = () => get('/company')
export const updateCompany = (values) => put('/company', values)
export const listFinancialYears = () => get('/company/financial-years')
export const addFinancialYear = (fromDate, toDate) => post('/company/financial-years', { from_date: fromDate, to_date: toDate })
export const setActiveFinancialYear = (fromDate) => put('/company/financial-years/active', { from_date: fromDate })
export const removeFinancialYear = (fromDate) => del(`/company/financial-years/${fromDate}`)
/** Company picture (MstComp.JpgFile) as a Blob; rejects with 404 when none is stored. */
export const getCompanyImage = () => download('/company/image')
export const setCompanyImage = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.put('/company/image', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
