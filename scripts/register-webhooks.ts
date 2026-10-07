export {}

const baseUrl = process.env.PUBLIC_BASE_URL
const adminToken = process.env.ADMIN_TOKEN
if (!baseUrl || !adminToken) throw new Error('PUBLIC_BASE_URL et ADMIN_TOKEN sont requis')
const response = await fetch(`${baseUrl.replace(/\/$/, '')}/admin/webhooks/register`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } })
console.log(await response.text())
if (!response.ok) process.exitCode = 1
