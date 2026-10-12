// Logo image with a light sweep that is clipped to the logo's own pixels (CSS mask of the same PNG),
// so the shine never spills onto the header or panel behind it.
export default function ShineLogo({ src, alt = '', imgClassName, wrapClassName = '', imgStyle, wrapStyle }) {
  return (
    <span className={`vt-shine ${wrapClassName}`} style={{ ...wrapStyle, '--vt-shine-src': `url(${src})` }}>
      <img className={imgClassName} src={src} alt={alt} style={imgStyle} />
      <span className="vt-shine-sweep" aria-hidden />
    </span>
  )
}
