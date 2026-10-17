import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import markUrl from '../../../../../apps/desktop/resources/icon.png'
import css from './Brand.module.css'

/**
 * Render the desktop application icon at the size the sidebar requested.
 * @param props - Host-supplied mark presentation.
 * @returns the Kito mark.
 */
export function KitoBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <img className={css.mark} src={markUrl} width={size} height={size} alt="Kito Harness" />
}

/**
 * Render the product name. A packaged `kito` build shows the name alone.
 * A local build keeps a short local marker and the product version, without
 * the commit hash or dirty flag.
 * @returns the Kito name row.
 */
export function KitoBrandName() {
  const version = process.env.DSH_CLIENT_VERSION
  if (process.env.DSH_CLIENT_BUILD_PROFILE === 'kito' || version === undefined) {
    return <span className={css.product}>Kito Harness</span>
  }
  return (
    <span className={css.local}>
      <span className={css.product}>Kito Harness</span>
      <span className={css.meta}>
        <span>本地</span>
        <span className={css.version}>{version}</span>
      </span>
    </span>
  )
}
