import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { KitoLocaleControls } from './AccountFooter.tsx'
import { zh } from './copy.ts'
import markUrl from './assets/icon.png'
import css from './Brand.module.css'

/**
 * Render the desktop application icon at the size the sidebar requested.
 * @param props - Host-supplied mark presentation and localized brand copy.
 * @returns the Kito mark.
 */
export function KitoBrandMark({ size, t }: SidebarBrandMarkOwnerProps & KitoLocaleControls) {
  return <img className={css.mark} src={markUrl} width={size} height={size} alt={t?.('productName') ?? zh.productName} />
}

/**
 * Render the product name. A packaged `kito` build shows the name alone.
 * A local build keeps a short local marker and the product version, without
 * the commit hash or dirty flag.
 * @param controls - localized brand copy.
 * @returns the Kito name row.
 */
export function KitoBrandName({ t }: KitoLocaleControls = {}) {
  const version = process.env.DSH_CLIENT_VERSION
  const productName = t?.('productName') ?? zh.productName
  if (process.env.DSH_CLIENT_BUILD_PROFILE === 'kito' || version === undefined) {
    return <span className={css.product}>{productName}</span>
  }
  return (
    <span className={css.local}>
      <span className={css.product}>{productName}</span>
      <span className={css.meta}>
        <span>{t?.('local') ?? zh.local}</span>
        <span className={css.version}>{version}</span>
      </span>
    </span>
  )
}
