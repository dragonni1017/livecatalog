import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

await page.goto('http://localhost:3000/admin/login')
await page.waitForLoadState('networkidle')

const emailInput = await page.$('input[type="email"]')
const passwordInput = await page.$('input[type="password"]')
console.log('Email field present:', !!emailInput)
console.log('Password field present:', !!passwordInput)

await page.screenshot({ path: 'scripts/login-page.png' })

const password = process.env.ADMIN_PASSWORD ?? ''
await page.fill('input[type="email"]', 'dragon@ly-usa.com')
await page.fill('input[type="password"]', password)

await Promise.all([
  page.waitForNavigation({ timeout: 8000 }).catch(() => null),
  page.click('button[type="submit"]'),
])

await page.waitForTimeout(2000)
const url = page.url()
console.log('After login URL:', url)
console.log('Landed on admin dashboard:', url.includes('/admin') && !url.includes('/login'))

await page.screenshot({ path: 'scripts/after-login.png' })
await browser.close()
