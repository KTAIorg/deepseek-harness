/** Brand marks for the vendor groups; see `assets/vendors/NOTICE.md`. */
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import type { ModelVendorKey } from './model-sections.ts'
import deepseek from './assets/vendors/deepseek.svg'
import anthropic from './assets/vendors/anthropic.svg'
import openai from './assets/vendors/openai.svg'
import google from './assets/vendors/google.svg'
import xai from './assets/vendors/xai.svg'
import moonshot from './assets/vendors/moonshot.svg'
import qwen from './assets/vendors/qwen.svg'
import zai from './assets/vendors/zai.svg'
import composer from './assets/vendors/composer.svg'
import css from './VendorIcon.module.css'

/** One vendored mark: `colored` marks carry their own fill, the rest mask to `currentColor`. */
interface VendorMark {
  src: string
  colored: boolean
}

/** Vendored marks keyed by the picker's vendor families; `other` has none. */
const MARKS: Readonly<Record<Exclude<ModelVendorKey, 'other'>, VendorMark>> = {
  deepseek: { src: deepseek, colored: true },
  anthropic: { src: anthropic, colored: true },
  openai: { src: openai, colored: false },
  xai: { src: xai, colored: false },
  google: { src: google, colored: true },
  moonshot: { src: moonshot, colored: false },
  qwen: { src: qwen, colored: true },
  zai: { src: zai, colored: false },
  composer: { src: composer, colored: false },
}

/**
 * Render the brand mark of one vendor family.
 * @param props.vendor - vendor family the mark names.
 * @param props.className - layout class applied to the mark.
 * @returns the mark, or nothing for the `other` family.
 */
export function VendorIcon({ vendor, className }: { vendor: ModelVendorKey; className?: string }) {
  if (vendor === 'other') return null
  const mark = MARKS[vendor]
  const classes = clsx(css.icon, className)
  if (mark.colored) {
    return <img className={classes} src={mark.src} alt="" aria-hidden="true" draggable={false} />
  }
  return (
    <span
      className={clsx(classes, css.glyph)}
      style={{ '--vendor-glyph': `url("${mark.src}")` } as CSSProperties}
      aria-hidden="true"
    />
  )
}
