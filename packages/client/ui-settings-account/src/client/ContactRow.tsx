/** General Settings row for the product's feedback form. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ContactRow.module.css'

/** Operations the row needs from the account feature. */
export interface ContactRowInjected {
  /** Open the support questionnaire with account, build and device facts sampled by this click. */
  contactUs: () => void
}

/**
 * Render the feedback entry that used to sit beside the sidebar settings shortcut.
 * @param props - injected opener and localized copy.
 * @returns the General Settings row.
 */
export function ContactRow({ contactUs, t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings.account'> & ContactRowInjected) {
  return <div className={css.row}>
    <div className={css.copy}>
      <div className={css.title}>{t('feedbackTitle')}</div>
      <div className={css.description}>{t('feedbackDescription')}</div>
    </div>
    <button type="button" className={css.action} onClick={contactUs}>{t('feedbackAction')}</button>
  </div>
}
