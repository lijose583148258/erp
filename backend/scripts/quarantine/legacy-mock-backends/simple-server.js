/**
 * Legacy mock backend.
 * This file is kept only for historical reference and ad-hoc demo use.
 * Main runtime now lives in src/server.ts.
 */
console.error('[legacy mock backend disabled] Use npm run start:stable or npm --prefix backend run start.');
process.exit(1);

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5001;

// CORS配置
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:5173'],
  credentials: true
}));

app.use(express.json());

// 模拟用户数据
const users = [
  { id: 1, username: 'admin', password: '__legacy_disabled__', email: 'admin@example.com', role: 'admin' },
  { id: 2, username: 'manager', password: '__legacy_disabled__', email: 'manager@example.com', role: 'manager' },
  { id: 3, username: 'sales', password: '__legacy_disabled__', email: 'sales@example.com', role: 'sales' }
];

// 登录接口
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = users.find(u => u.username === username && u.password === password);
  
  if (user) {
    res.json({
      success: true,
      data: {
        token: 'mock-jwt-token-' + Date.now(),
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }
    });
  } else {
    res.status(401).json({
      success: false,
      message: '用户名或密码错误'
    });
  }
});

// 其他API接口模拟
app.get('/api/*', (req, res) => {
  res.json({ success: true, data: [] });
});

app.post('/api/*', (req, res) => {
  res.json({ success: true, message: '操作成功' });
});

app.put('/api/*', (req, res) => {
  res.json({ success: true, message: '更新成功' });
});

app.delete('/api/*', (req, res) => {
  res.json({ success: true, message: '删除成功' });
});

app.listen(PORT, () => {
  console.log(`✅ 简易后端服务已启动: http://localhost:${PORT}`);
  console.log(`✅ API地址: http://localhost:${PORT}/api`);
});
