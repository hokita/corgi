import { test, expect } from '@playwright/test'

test.describe('login', () => {
  test('redirects an unauthenticated visitor to the login page', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  })

  test('signs in and lands on the chat page', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in with Google' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Start a conversation')).toBeVisible()
  })

  test('signs out and returns to the login page', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in with Google' }).click()
    await expect(page.getByText('Start a conversation')).toBeVisible()

    await page.getByAltText('user').click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})
