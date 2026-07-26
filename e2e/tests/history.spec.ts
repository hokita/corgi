import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore } from '../fixtures/firestore'

test.describe('history', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('switches between, deletes, and starts new conversations', async ({ page }) => {
    await page.getByPlaceholder('Message...').fill('Conversation A')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByTestId('message-balloon-assistant')).toHaveText('This is a stub reply.')

    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(page.getByText('Start a conversation')).toBeVisible()

    await page.getByPlaceholder('Message...').fill('Conversation B')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByTestId('message-balloon-assistant')).toHaveText('This is a stub reply.')

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    const rows = page.locator('[data-testid^="conversation-row-"]')
    await expect(rows).toHaveCount(2)
    const conversationARow = rows.filter({ hasText: 'Conversation A' })
    const conversationBRow = rows.filter({ hasText: 'Conversation B' })
    await expect(conversationARow).toBeVisible()
    await expect(conversationBRow).toBeVisible()

    await conversationARow.click()
    await expect(page.getByTestId('message-balloon-user')).toHaveText('Conversation A')

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await conversationBRow.getByRole('button', { name: 'Delete conversation' }).click()
    await expect(conversationBRow).toHaveCount(0)
    await expect(rows).toHaveCount(1)

    await page.getByRole('button', { name: '+ New chat' }).click()
    await expect(page.getByText('Start a conversation')).toBeVisible()
  })
})
