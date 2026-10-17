import { describe, expect, it } from 'vitest'
import { shouldDismissNewWelcome } from '../src/kito-welcome-policy.ts'

describe('Kito welcome open policy', () => {
  it('keeps an explicit Telegram sign-in open after the workspace is already showing', () => {
    expect(shouldDismissNewWelcome({
      explicitSignIn: true, quitting: false, recoveryActive: false, enteredWorkspace: true,
    })).toBe(false)
  })

  it('does not open the startup welcome over a workspace that is already entered', () => {
    expect(shouldDismissNewWelcome({
      explicitSignIn: false, quitting: false, recoveryActive: false, enteredWorkspace: true,
    })).toBe(true)
  })
})
