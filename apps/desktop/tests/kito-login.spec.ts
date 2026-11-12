import { describe, expect, it } from 'vitest'
import {
  classifyPoll, classifyTransport, forgetRecentAccount, loginScreen, normalizeTelegramHint,
  PUSH_COOLDOWN_MS, rememberRecentAccount, resendAllowed,
} from '../src/kito-login.ts'

describe('telegram login hint', () => {
  it.each([
    ['  Ada_T  ', 'ada_t'],
    ['@Ada_T', 'ada_t'],
    ['telegram:@Ada_T', 'ada_t'],
    ['kt:KT2510', 'kt2510'],
    ['@', ''],
    ['   ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeTelegramHint(input)).toBe(expected)
  })
})

describe('device session poll', () => {
  it.each([
    ['pending', 'wait'],
    ['', 'wait'],
    ['approved', 'exchange'],
    ['confirmed', 'exchange'],
    ['denied', 'denied'],
    ['expired', 'expired'],
    ['consumed', 'consumed'],
    ['weird', 'protocol'],
  ] as const)('classifies %j as %j', (status, expected) => {
    expect(classifyPoll(status)).toBe(expected)
  })

  it('keeps waiting through the first transport blips and then stops', () => {
    expect(classifyTransport(429, 1)).toBe('retry')
    expect(classifyTransport(503, 4)).toBe('retry')
    expect(classifyTransport(429, 5)).toBe('rate-limited')
    expect(classifyTransport(502, 5)).toBe('network')
    expect(classifyTransport(401, 1)).toBe('network')
    expect(classifyTransport(404, 1)).toBe('network')
  })
})

describe('resend and recent accounts', () => {
  it('blocks a resend until the cooldown elapses', () => {
    const start = 1_000
    expect(resendAllowed(start, undefined)).toBe(true)
    expect(resendAllowed(start + PUSH_COOLDOWN_MS - 1, start + PUSH_COOLDOWN_MS)).toBe(false)
    expect(resendAllowed(start + PUSH_COOLDOWN_MS, start + PUSH_COOLDOWN_MS)).toBe(true)
  })

  it('keeps three accounts, newest first, without duplicating one', () => {
    const first = rememberRecentAccount([], { accountNo: 'a' }, 't1')
    const second = rememberRecentAccount(first, { accountNo: 'b', displayName: 'B' }, 't2')
    const third = rememberRecentAccount(second, { accountNo: 'c' }, 't3')
    const fourth = rememberRecentAccount(third, { accountNo: 'd' }, 't4')
    const again = rememberRecentAccount(fourth, { accountNo: 'b', avatarUrl: 'https://example.test/b.png' }, 't5')
    expect(fourth.map(item => item.accountNo)).toEqual(['d', 'c', 'b'])
    expect(again.map(item => item.accountNo)).toEqual(['b', 'd', 'c'])
    expect(again[0]).toMatchObject({ displayName: 'B', avatarUrl: 'https://example.test/b.png', lastLoginAt: 't5' })
    expect(forgetRecentAccount(again, 'd').map(item => item.accountNo)).toEqual(['b', 'c'])
  })
})

describe('welcome surface', () => {
  it.each([
    [{ recentCount: 0, showForm: false }, 'username'],
    [{ recentCount: 2, showForm: false }, 'recent'],
    [{ recentCount: 2, showForm: true }, 'username'],
    [{ recentCount: 2, showForm: false, phase: 'cancelled' }, 'recent'],
    [{ recentCount: 0, showForm: false, phase: 'cancelled' }, 'username'],
    [{ recentCount: 2, showForm: false, phase: 'initializing' }, 'waiting'],
    [{ recentCount: 2, showForm: false, phase: 'waiting-browser' }, 'waiting'],
    [{ recentCount: 2, showForm: false, phase: 'exchanging' }, 'waiting'],
    [{ recentCount: 2, showForm: false, phase: 'committing' }, 'waiting'],
    [{ recentCount: 2, showForm: false, phase: 'failed' }, 'failed'],
    [{ recentCount: 2, showForm: false, phase: 'expired' }, 'failed'],
    [{ recentCount: 2, showForm: false, phase: 'succeeded' }, 'recent'],
  ] as const)('selects the surface for %j', (input, expected) => {
    expect(loginScreen(input)).toBe(expected)
  })
})
