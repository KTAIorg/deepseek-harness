/** Compact language control: a flag button that opens the language list. */
import { useEffect, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KitoLocaleControls } from './AccountFooter.tsx'
import { en, zh, type KitoAccountCopyKey } from './copy.ts'
import css from './Brand.module.css'

interface LanguageChoice {
  readonly id: string
  readonly native: string
  readonly zhName: string
  readonly region: 'common' | 'southeastAsia' | 'southAsia' | 'africaMiddleEast'
}

/** Languages offered beside this project's Chinese and English. */
export const KITO_LANGUAGES: readonly LanguageChoice[] = [
  { id: 'zh', native: '中文', zhName: '中文', region: 'common' },
  { id: 'en', native: 'English', zhName: '英语', region: 'common' },
  { id: 'hi', native: 'हिन्दी', zhName: '印地语', region: 'common' },
  { id: 'vi', native: 'Tiếng Việt', zhName: '越南语', region: 'southeastAsia' },
  { id: 'th', native: 'ภาษาไทย', zhName: '泰语', region: 'southeastAsia' },
  { id: 'id', native: 'Indonesia', zhName: '印尼语', region: 'southeastAsia' },
  { id: 'my', native: 'မြန်မာ', zhName: '缅甸语', region: 'southeastAsia' },
  { id: 'fil', native: 'Filipino', zhName: '菲律宾语', region: 'southeastAsia' },
  { id: 'km', native: 'ខ្មែរ', zhName: '高棉语', region: 'southeastAsia' },
  { id: 'si', native: 'සිංහල', zhName: '僧伽罗语', region: 'southAsia' },
  { id: 'ne', native: 'नेपाली', zhName: '尼泊尔语', region: 'southAsia' },
  { id: 'lus', native: 'Mizo', zhName: '米佐语', region: 'southAsia' },
  { id: 'am', native: 'አማርኛ', zhName: '阿姆哈拉语', region: 'africaMiddleEast' },
  { id: 'om', native: 'Oromo', zhName: '奥罗莫语', region: 'africaMiddleEast' },
  { id: 'ar', native: 'العربية', zhName: '阿拉伯语', region: 'africaMiddleEast' },
]

const REGION_LABEL: Record<LanguageChoice['region'], KitoAccountCopyKey> = {
  common: 'regionCommon',
  southeastAsia: 'regionSoutheastAsia',
  southAsia: 'regionSouthAsia',
  africaMiddleEast: 'regionAfricaMiddleEast',
}

/** Extra languages registered onto the shared catalog. Chinese and English are already built in. */
export const KITO_EXTRA_LANGUAGES = KITO_LANGUAGES
  .filter(item => item.id !== 'zh' && item.id !== 'en')
  .map(item => ({ id: item.id, label: item.native, fallback: 'en' as const }))

function Flag({ code }: { code: string }) {
  return (
    <svg className={code === 'en' || code === 'ar' ? css.flagGlobe : css.flag} viewBox="0 0 24 16" aria-hidden="true">
      <rect width="24" height="16" fill="#f0f0f0" rx="2" />
      {code === 'zh' && (
        <>
          <rect width="24" height="16" fill="#de2910" rx="2" />
          <path fill="#ffde00" d="M6 3.2 7.03 6.36 4.2 4.31h3.6L4.97 6.36z" />
        </>
      )}
      {(code === 'en' || code === 'ar') && (
        <>
          <circle cx="12" cy="8" r="7" fill="#4285f4" />
          <ellipse cx="12" cy="8" rx="3" ry="7" fill="none" stroke="#fff" strokeWidth="0.9" />
          <path d="M5 8h14M6.5 4.4h11M6.5 11.6h11" stroke="#fff" strokeWidth="0.9" fill="none" />
        </>
      )}
      {code === 'hi' && (
        <>
          <rect width="24" height="5.34" fill="#f93" rx="2" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <rect y="10.66" width="24" height="5.34" fill="#128807" rx="2" />
          <circle cx="12" cy="8" r="2.2" fill="none" stroke="#000080" strokeWidth="0.8" />
        </>
      )}
      {code === 'vi' && (
        <>
          <rect width="24" height="16" fill="#da251d" rx="2" />
          <path fill="#ff0" d="M12 4.1 13.9 9.93 8.99 6.37h6.02l-4.9 3.56z" />
        </>
      )}
      {code === 'th' && (
        <>
          <rect width="24" height="16" fill="#f00" rx="2" />
          <rect y="2.6" width="24" height="10.8" fill="#fff" />
          <rect y="5.2" width="24" height="5.6" fill="#241d4f" />
        </>
      )}
      {code === 'id' && (
        <>
          <rect width="24" height="8" fill="#ce1126" rx="2" />
          <rect y="8" width="24" height="8" fill="#fff" />
        </>
      )}
      {code === 'my' && (
        <>
          <rect width="24" height="5.34" fill="#fecd07" rx="2" />
          <rect y="5.33" width="24" height="5.34" fill="#34a853" />
          <rect y="10.66" width="24" height="5.34" fill="#ea4335" rx="2" />
        </>
      )}
      {code === 'fil' && (
        <>
          <rect width="24" height="8" fill="#0038a8" rx="2" />
          <rect y="8" width="24" height="8" fill="#ce1126" />
          <path d="M0 0 L10 8 L0 16 Z" fill="#fff" />
        </>
      )}
      {code === 'km' && (
        <>
          <rect width="24" height="4" fill="#032ea1" rx="2" />
          <rect y="4" width="24" height="8" fill="#e00025" />
          <rect y="12" width="24" height="4" fill="#032ea1" />
        </>
      )}
      {code === 'si' && <rect width="24" height="16" fill="#8d153a" rx="2" />}
      {code === 'ne' && <path d="M2 15V1l7.5 3.5V1L17 4.5l4 2L17 9v6z" fill="#dc143c" />}
      {(code === 'am' || code === 'om') && (
        <>
          <rect width="24" height="5.34" fill="#078930" rx="2" />
          <rect y="5.33" width="24" height="5.34" fill="#fcdd09" />
          <rect y="10.66" width="24" height="5.34" fill="#da121a" />
        </>
      )}
      {code === 'lus' && (
        <>
          <rect width="24" height="5.34" fill="#f93" rx="2" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <rect y="10.66" width="24" height="5.34" fill="#128807" />
        </>
      )}
    </svg>
  )
}

/** Locale controls and the visibility of a sessionless trailing entry. */
export interface KitoLanguageDockProps extends KitoLocaleControls {
  /** Selected Session supplied by the slot, absent when none is selected. */
  readonly sessionId?: PropsRuntime<'conversation.header.trailing'>['sessionId']
  /** Show this entry only when no Session is selected. */
  readonly hideWhenSession?: boolean
}

/**
 * One flag button, shown only by the placement that owns the current Session state.
 * @param props - locale controls and sessionless-entry visibility.
 * @returns the picker, or null when a Session-specific placement owns the entry.
 */
export function KitoLanguageDock({ hideWhenSession, sessionId, ...controls }: KitoLanguageDockProps) {
  if (hideWhenSession && sessionId !== undefined) return null
  return <KitoLanguageDockView {...controls} />
}

function KitoLanguageDockView(controls: KitoLocaleControls) {
  const { active } = useActiveLocale(controls)
  const current = KITO_LANGUAGES.find(item => item.id === active) ?? KITO_LANGUAGES[0]
  const [open, setOpen] = useState(false)
  const chinese = active === 'zh'
  const label = (key: KitoAccountCopyKey): string => controls.t?.(key) ?? (chinese ? zh[key] : en[key])
  /* v8 ignore next -- KITO_LANGUAGES always includes zh as the fallback. */
  if (current === undefined || controls.setLocale === undefined) return null
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      portal
      autoFocus
      align="end"
      className={css.languageDock}
      listClassName={css.languagePanel}
      anchor={(
        <button
          type="button"
          className={css.languageTrigger}
          aria-label={current.native}
          aria-haspopup="menu"
          aria-expanded={open}
          title={label('language')}
          onClick={() => { setOpen(value => !value) }}
        >
          <Flag code={current.id} />
        </button>
      )}
    >
      {(['common', 'southeastAsia', 'southAsia', 'africaMiddleEast'] as const).map(region => (
        <section key={region}>
          <p className={css.languageGroup}>{label(REGION_LABEL[region])}</p>
          <div className={css.languageGrid}>
            {KITO_LANGUAGES.filter(item => item.region === region).map(item => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={item.id === active ? css.languageOptionActive : css.languageOption}
                onClick={() => { controls.setLocale?.(item.id); setOpen(false) }}
              >
                <Flag code={item.id} />
                <span>{item.native}</span>
                {item.id !== active && <span className={css.languageAux}>{chinese ? item.zhName : item.native}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </Menu>
  )
}

function useActiveLocale(controls: KitoLocaleControls): { active: string } {
  const read = controls.readLocale
  const subscribe = controls.subscribeLocale
  const [active, setActive] = useState(() => read?.() ?? 'zh')
  useEffect(() => {
    if (subscribe === undefined) return undefined
    const sync = (): void => { setActive(read?.() ?? 'zh') }
    sync()
    return subscribe(sync)
  }, [read, subscribe])
  return { active }
}
