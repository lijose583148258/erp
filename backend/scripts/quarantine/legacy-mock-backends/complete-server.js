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

// ==================== 数据存储 ====================

// 用户数据
const users = [
  { id: 1, username: 'admin', password: '__legacy_disabled__', email: 'admin@example.com', role: 'admin', name: '管理员' },
  { id: 2, username: 'manager', password: '__legacy_disabled__', email: 'manager@example.com', role: 'manager', name: '经理' },
  { id: 3, username: 'sales', password: '__legacy_disabled__', email: 'sales@example.com', role: 'sales', name: '业务员' }
];

// 客户数据
let customers = [];
let customerIdCounter = 1;

// 订单数据
let orders = [];
let orderIdCounter = 1;

// 样品数据
let samples = [];
let sampleIdCounter = 1;

// 物流数据
let shipments = [];
let shipmentIdCounter = 1;

// RMA数据
let rmas = [];
let rmaIdCounter = 1;

// ==================== 认证接口 ====================

// 登录
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
          role: user.role,
          name: user.name
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

// ==================== 客户管理接口 ====================

// 获取客户列表
app.get('/api/customers', (req, res) => {
  res.json({
    success: true,
    data: customers,
    total: customers.length
  });
});

// 获取单个客户
app.get('/api/customers/:id', (req, res) => {
  const customer = customers.find(c => c.id === parseInt(req.params.id));
  if (customer) {
    res.json({
      success: true,
      data: customer
    });
  } else {
    res.status(404).json({
      success: false,
      message: '客户不存在'
    });
  }
});

// 创建客户
app.post('/api/customers', (req, res) => {
  try {
    const { name, contact, phone, email, address, creditLimit, paymentTerms, taxCode, riskLevel } = req.body;
    
    // 数据验证
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '客户名称不能为空'
      });
    }
    
    // 检查重复
    const exists = customers.find(c => c.name === name);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: '客户名称已存在'
      });
    }
    
    const newCustomer = {
      id: customerIdCounter++,
      code: `C-${String(customerIdCounter).padStart(6, '0')}`,
      name: name.trim(),
      contact: contact || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      creditLimit: parseFloat(creditLimit) || 0,
      paymentTerms: paymentTerms || '30天',
      taxCode: taxCode || '',
      riskLevel: riskLevel || '低风险',
      status: '正常',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    customers.push(newCustomer);
    
    res.json({
      success: true,
      message: '客户创建成功',
      data: newCustomer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// 更新客户
app.put('/api/customers/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const index = customers.findIndex(c => c.id === id);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '客户不存在'
      });
    }
    
    const { name, contact, phone, email, address, creditLimit, paymentTerms, taxCode, riskLevel } = req.body;
    
    // 数据验证
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '客户名称不能为空'
      });
    }
    
    // 检查重复（排除自己）
    const exists = customers.find(c => c.name === name && c.id !== id);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: '客户名称已存在'
      });
    }
    
    customers[index] = {
      ...customers[index],
      name: name.trim(),
      contact: contact || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      creditLimit: parseFloat(creditLimit) || 0,
      paymentTerms: paymentTerms || '30天',
      taxCode: taxCode || '',
      riskLevel: riskLevel || '低风险',
      updatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: '客户更新成功',
      data: customers[index]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// 删除客户
app.delete('/api/customers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = customers.findIndex(c => c.id === id);
  
  if (index === -1) {
    return res.status(404).json({
      success: false,
      message: '客户不存在'
    });
  }
  
  customers.splice(index, 1);
  
  res.json({
    success: true,
    message: '客户删除成功'
  });
});

// ==================== 订单管理接口 ====================

// 获取订单列表
app.get('/api/orders', (req, res) => {
  res.json({
    success: true,
    data: orders,
    total: orders.length
  });
});

// 获取单个订单
app.get('/api/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (order) {
    res.json({
      success: true,
      data: order
    });
  } else {
    res.status(404).json({
      success: false,
      message: '订单不存在'
    });
  }
});

// 创建订单
app.post('/api/orders', (req, res) => {
  try {
    const { customerId, customerName, items, products, paymentTerms, paymentTermsDays, currency, totalAmount, notes, extraItems, taxInclusive, commissionRate } = req.body;
    
    // 兼容前端不同的字段名
    const orderItems = items || products || [];
    
    // 数据验证
    if (!customerId && !customerName) {
      return res.status(400).json({
        success: false,
        message: '客户信息不能为空'
      });
    }
    
    if (orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: '至少需要添加一个产品'
      });
    }
    
    // 验证产品数据
    for (let i = 0; i < orderItems.length; i++) {
      const p = orderItems[i];
      const name = p.name || p.productName;
      const quantity = p.quantity;
      const price = p.price || p.unitPrice;
      
      if (!name || !quantity || !price) {
        return res.status(400).json({
          success: false,
          message: `产品${i + 1}：名称、数量和单价不能为空`
        });
      }
    }
    
    // 计算总金额
    let calculatedTotal = 0;
    const processedItems = orderItems.map(p => {
      const quantity = parseFloat(p.quantity) || 0;
      const price = parseFloat(p.price || p.unitPrice) || 0;
      const discount = parseFloat(p.discount) || 0;
      const amount = (quantity * price) - discount;
      calculatedTotal += amount;
      
      return {
        productName: p.name || p.productName,
        spec: p.spec || '',
        quantity: quantity,
        unit: p.unit || '件',
        unitPrice: price,
        discount: discount,
        amount: amount
      };
    });
    
    const newOrder = {
      id: orderIdCounter++,
      orderNo: `SO-${new Date().getFullYear()}-${String(orderIdCounter).padStart(6, '0')}`,
      customerId: customerId || null,
      customerName: customerName || '',
      orderDate: new Date().toISOString().split('T')[0],
      items: processedItems,
      extraItems: extraItems || [],
      paymentTerms: paymentTerms || `${paymentTermsDays || 30}天`,
      paymentTermsDays: paymentTermsDays || 30,
      currency: currency || 'CNY',
      totalAmount: parseFloat(totalAmount) || calculatedTotal,
      paidAmount: 0,
      notes: notes || '',
      taxInclusive: taxInclusive || false,
      commissionRate: commissionRate || 3,
      commissionAmount: 0,
      status: '待审核',
      paymentStatus: '未付款',
      commissionStatus: '未发放',
      paymentRecords: [],
      historyLogs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    orders.push(newOrder);
    
    console.log(`✅ 订单创建成功: ${newOrder.orderNo}`);
    
    res.json({
      success: true,
      message: '订单创建成功',
      data: newOrder
    });
  } catch (error) {
    console.error('❌ 订单创建失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// 更新订单
app.put('/api/orders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === id);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '订单不存在'
      });
    }
    
    const { customerId, customerName, products, paymentTerms, currency, totalAmount, notes, status } = req.body;
    
    orders[index] = {
      ...orders[index],
      customerId: customerId || orders[index].customerId,
      customerName: customerName || orders[index].customerName,
      products: products || orders[index].products,
      paymentTerms: paymentTerms || orders[index].paymentTerms,
      currency: currency || orders[index].currency,
      totalAmount: parseFloat(totalAmount) || orders[index].totalAmount,
      notes: notes !== undefined ? notes : orders[index].notes,
      status: status || orders[index].status,
      updatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: '订单更新成功',
      data: orders[index]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// 删除订单
app.delete('/api/orders/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = orders.findIndex(o => o.id === id);
  
  if (index === -1) {
    return res.status(404).json({
      success: false,
      message: '订单不存在'
    });
  }
  
  orders.splice(index, 1);
  
  res.json({
    success: true,
    message: '订单删除成功'
  });
});

// ==================== 样品管理接口 ====================

// 获取样品列表
app.get('/api/samples', (req, res) => {
  res.json({
    success: true,
    data: samples,
    total: samples.length
  });
});

// 创建样品申请
app.post('/api/samples', (req, res) => {
  try {
    const { customerId, customerName, productName, spec, quantity, weight, address, contact, phone, notes } = req.body;
    
    // 数据验证
    if (!customerName) {
      return res.status(400).json({
        success: false,
        message: '客户名称不能为空'
      });
    }
    
    if (!productName) {
      return res.status(400).json({
        success: false,
        message: '样品名称不能为空'
      });
    }
    
    const newSample = {
      id: sampleIdCounter++,
      sampleNo: `SAM-${new Date().getFullYear()}-${String(sampleIdCounter).padStart(6, '0')}`,
      customerId: customerId || null,
      customerName: customerName,
      productName: productName,
      spec: spec || '',
      quantity: parseInt(quantity) || 1,
      weight: weight || '',
      address: address || '',
      contact: contact || '',
      phone: phone || '',
      notes: notes || '',
      status: '待处理',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    samples.push(newSample);
    
    res.json({
      success: true,
      message: '样品申请创建成功',
      data: newSample
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// 更新样品
app.put('/api/samples/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const index = samples.findIndex(s => s.id === id);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '样品不存在'
      });
    }
    
    samples[index] = {
      ...samples[index],
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: '样品更新成功',
      data: samples[index]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// ==================== 物流管理接口 ====================

// 获取物流列表
app.get('/api/shipments', (req, res) => {
  res.json({
    success: true,
    data: shipments,
    total: shipments.length
  });
});

// 创建物流
app.post('/api/shipments', (req, res) => {
  try {
    const newShipment = {
      id: shipmentIdCounter++,
      trackingNo: `SHIP-${new Date().getFullYear()}-${String(shipmentIdCounter).padStart(6, '0')}`,
      ...req.body,
      status: req.body.status || '待发货',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    shipments.push(newShipment);
    
    res.json({
      success: true,
      message: '物流信息创建成功',
      data: newShipment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// ==================== RMA管理接口 ====================

// 获取RMA列表
app.get('/api/rma', (req, res) => {
  res.json({
    success: true,
    data: rmas,
    total: rmas.length
  });
});

// 创建RMA
app.post('/api/rma', (req, res) => {
  try {
    const newRma = {
      id: rmaIdCounter++,
      rmaNo: `RMA-${new Date().getFullYear()}-${String(rmaIdCounter).padStart(6, '0')}`,
      ...req.body,
      status: req.body.status || '待审核',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    rmas.push(newRma);
    
    res.json({
      success: true,
      message: 'RMA创建成功',
      data: newRma
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器错误：' + error.message
    });
  }
});

// ==================== 仪表盘接口 ====================

// 获取仪表盘数据
app.get('/api/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      customers: {
        total: customers.length,
        active: customers.filter(c => c.status === '正常').length,
        highRisk: customers.filter(c => c.riskLevel === '高风险').length
      },
      orders: {
        total: orders.length,
        pending: orders.filter(o => o.status === '待审核').length,
        processing: orders.filter(o => o.status === '处理中').length,
        completed: orders.filter(o => o.status === '已完成').length
      },
      samples: {
        total: samples.length,
        pending: samples.filter(s => s.status === '待处理').length
      },
      shipments: {
        total: shipments.length,
        pending: shipments.filter(s => s.status === '待发货').length,
        shipping: shipments.filter(s => s.status === '运输中').length
      }
    }
  });
});

// ==================== 通用接口 ====================

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date().toISOString()
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: '服务器内部错误'
  });
});

// ==================== 启动服务 ====================

app.listen(PORT, () => {
  console.log(`✅ 后端服务已启动: http://localhost:${PORT}`);
  console.log(`✅ API地址: http://localhost:${PORT}/api`);
  console.log(`\n📊 当前数据统计:`);
  console.log(`   - 客户: ${customers.length} 个`);
  console.log(`   - 订单: ${orders.length} 个`);
  console.log(`   - 样品: ${samples.length} 个`);
  console.log(`   - 物流: ${shipments.length} 个`);
  console.log(`\n🎯 系统已就绪，等待请求...`);
});
