const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ code: 500, message: err.message || 'Internal Server Error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`================================================`);
    console.log(`  票据收款认领与异常挂账服务`);
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  健康检查: http://localhost:${PORT}/api/health`);
    console.log(`  数据目录: ${require('path').join(__dirname, '..', 'data')}`);
    console.log(`================================================`);
  });
}

module.exports = app;
