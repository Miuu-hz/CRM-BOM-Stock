const express = require('express')
const path = require('path')
process.chdir('/opt/crm/backend')
const attachmentsRoutes = require('/opt/crm/backend/dist/routes/attachments.routes').default

const app = express()
app.use((req, res, next) => {
  const h = req.headers['x-test-user']
  if (h) req.user = JSON.parse(Buffer.from(h, 'base64').toString())
  next()
})
app.use('/api/attachments', attachmentsRoutes)
app.listen(5099, () => console.log('harness up on 5099'))
