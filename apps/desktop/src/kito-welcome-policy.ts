/** When a newly created welcome window should be closed before the person sees it. */

export interface WelcomeOpenContext {
  /** The person asked to sign in from the workspace. That window must stay. */
  readonly explicitSignIn: boolean
  readonly quitting: boolean
  readonly recoveryActive: boolean
  readonly enteredWorkspace: boolean
}

/**
 * Startup must not cover an open workspace. An explicit Telegram sign-in must.
 * @param input - why the window was created and the shell state at that moment.
 * @returns whether the new window should close immediately.
 */
export function shouldDismissNewWelcome(input: WelcomeOpenContext): boolean {
  if (input.explicitSignIn) return false
  return input.quitting || input.recoveryActive || input.enteredWorkspace
}
