import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { parseTemplate } from '../../utils/alertifyPills'

const pillEl = (caption) => {
  const s = document.createElement('span')
  s.setAttribute('data-pill', caption)
  s.contentEditable = 'false'
  s.className = 'al-pill'
  s.textContent = caption
  return s
}

function serialise(root) {
  let out = ''
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.nodeValue
    else if (n.nodeName === 'BR') out += '\n'
    else if (n.dataset?.pill) out += `${out === '' || /\s$/.test(out) ? '' : ' '}<<${n.dataset.pill}>> ` // a pill never touches the next word or pill
    else out += serialise(n) + (n.nodeName === 'DIV' || n.nodeName === 'P' ? '\n' : '')
  })
  return out
}

/**
 * A small text box that holds plain text and field pills. The value is the text with each pill written <<Caption>>.
 * Methods: insert(caption) puts a pill at the cursor, getValue(). `single` keeps it to one line (the title).
 */
const PillEditor = forwardRef(function PillEditor({ initial = '', single = false, placeholder, ariaLabel, onFocus, onChange, minHeight = 44 }, ref) {
  const box = useRef(null)
  const range = useRef(null)

  useEffect(() => {
    const el = box.current
    el.textContent = ''
    for (const part of parseTemplate(initial)) el.append(part.pill ? pillEl(part.pill) : document.createTextNode(part.text))
    // the initial text is only read once; later edits are the user's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remember = () => {
    const sel = window.getSelection()
    if (sel?.rangeCount && box.current.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange()
  }
  useImperativeHandle(ref, () => ({
    getValue: () => serialise(box.current).replace(/\u00a0/g, ' ').replace(single ? /\s*\n\s*/g : /$^/, ' ').replace(/[ \t]{2,}/g, ' ').trimEnd(),
    focus: () => box.current.focus(),
    insert(caption) {
      const el = box.current
      el.focus()
      const sel = window.getSelection()
      let r = range.current
      if (!r || !el.contains(r.startContainer)) {
        r = document.createRange()
        r.selectNodeContents(el)
        r.collapse(false)
      }
      sel.removeAllRanges()
      sel.addRange(r)
      r.deleteContents()
      const pill = pillEl(caption)
      const space = document.createTextNode(' ')
      r.insertNode(space)
      r.insertNode(pill)
      r.setStartAfter(space)
      r.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r)
      range.current = r.cloneRange()
      onChange?.()
    },
  }))

  return (
    <div
      ref={box}
      className="al-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={!single}
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      style={{ minHeight }}
      onFocus={() => onFocus?.()}
      onKeyUp={remember}
      onMouseUp={remember}
      onBlur={remember}
      onInput={() => onChange?.()}
      onKeyDown={(e) => { if (single && e.key === 'Enter') e.preventDefault() }}
      onPaste={(e) => {
        e.preventDefault()
        const t = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, single ? t.replace(/\s*\n\s*/g, ' ') : t)
      }}
    />
  )
})

export default PillEditor
