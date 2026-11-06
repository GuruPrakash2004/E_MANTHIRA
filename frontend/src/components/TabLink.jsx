import { forwardRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { openInTab } from '../lib/tabs'

/**
 * A router Link for the sidebar / header menus: a plain click on a different screen opens it in its own browser tab
 * (or switches to the tab that already has it). Ctrl / Shift / middle click and links to the current screen keep the
 * browser's normal behaviour.
 */
const TabLink = forwardRef(function TabLink({ to, onClick, target, ...rest }, ref) {
  const location = useLocation()
  const handle = (e) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || target) return
    const path = typeof to === 'string' ? to : to?.pathname
    if (!path || path === '#' || path === location.pathname + location.search) return
    if (openInTab(path)) e.preventDefault()
  }
  return <Link ref={ref} to={to} target={target} onClick={handle} {...rest} />
})

export default TabLink
