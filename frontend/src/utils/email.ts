// Strips any non-ASCII character (Thai vowels/tone marks, IME leftovers, etc.)
// from email input as the user types — prevents invisible stray characters
// (e.g. a leading Thai sara that looks like part of the email but breaks the
// exact-match login lookup) from ever reaching the backend.
export const stripNonAscii = (value: string): string => value.replace(/[^\x00-\x7F]/g, '')

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
