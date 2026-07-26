import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore } from '../fixtures/firestore'

test.describe('chat', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('sends a message and shows the streamed reply', async ({ page }) => {
    await page.getByPlaceholder('Message...').fill('Hello from Playwright')
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.getByTestId('message-balloon-user')).toHaveText('Hello from Playwright')
    await expect(page.getByTestId('message-balloon-assistant')).toHaveText('This is a stub reply.')
  })

  test('persists the conversation across a reload', async ({ page }) => {
    await page.getByPlaceholder('Message...').fill('Hello from Playwright')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByTestId('message-balloon-assistant')).toHaveText('This is a stub reply.')

    await page.reload()
    await expect(page.getByText('Start a conversation')).toBeVisible()

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await page.locator('[data-testid^="conversation-row-"]').first().click()

    await expect(page.getByTestId('message-balloon-user')).toHaveText('Hello from Playwright')
    await expect(page.getByTestId('message-balloon-assistant')).toHaveText('This is a stub reply.')
  })
})
