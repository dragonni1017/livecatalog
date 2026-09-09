import type { AuthError } from '@supabase/supabase-js'

// Supabase Auth surfaces some failures with no usable message at all. When
// GoTrue can't hand a message to SMTP it answers 500 with an empty JSON body,
// which the SDK stringifies to the literal "{}" — so customers were shown a
// bare "{}" as their error. Map the ones a customer can actually hit onto
// something that says what happened and what to do.
export function friendlyAuthError(error: AuthError | null | undefined): string | null {
  if (!error) return null

  const raw = (error.message ?? '').trim()

  // Empty/placeholder body — nearly always a send failure on GoTrue's side
  // (bad SMTP credentials, or a sender address the SMTP host won't relay).
  // Nothing the customer did, and nothing retrying will fix.
  if (!raw || raw === '{}' || raw === '[object Object]') {
    return "We couldn't send that email — our email service is having a problem. This isn't something you did. Please contact us and we'll set your account up directly."
  }

  if (/rate limit/i.test(raw)) {
    return 'Too many email requests right now. Please wait a few minutes and try again, or contact us and we can set your password directly.'
  }

  if (/error sending/i.test(raw)) {
    return "We couldn't send that email — our email service is having a problem. Please contact us and we'll help you get in."
  }

  if (/already registered|already exists|user already/i.test(raw)) {
    return 'An account with this email already exists. Sign in instead, or use "Forgot your password?" below.'
  }

  if (/invalid login credentials/i.test(raw)) {
    return 'That email and password combination is incorrect.'
  }

  if (/email not confirmed/i.test(raw)) {
    return "Your email address hasn't been confirmed yet. Contact us and we'll activate your account."
  }

  return raw
}
