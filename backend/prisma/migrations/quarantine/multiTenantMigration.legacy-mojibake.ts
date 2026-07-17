// 多租户数据库迁移工具脚本
// 这个脚本用于管理物理分库架构下的数据库迁移

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 经销商数据库配置
const DEALER_DATABASES = [
  'dealer_hanoi',
  'dealer_saigon', 
  'dealer_haiphong'
];

// 主数据库配置
const MAIN_DATABASE = 'main';

class MultiTenantMigration {
  static prismaDir = join(__dirname, '..');
  
  // 初始化所有数据库
  static initializeAllDatabases() {
    console.log('🚀 开始初始化多租户数据库架构...\n');
    
    // 1. 初始化主数据库
    console.log('📦 初始化主数据库...');
    this.runMigration(MAIN_DATABASE, 'init_main_db');
    
    // 2. 初始化所有经销商数据库
    DEALER_DATABASES.forEach(dealerId => {
      console.log(`\n🏢 初始化经销商数据库: ${dealerId}...`);
      this.runMigration(dealerId, `init_${dealerId}`);
    });
    
    console.log('\n✅ 所有数据库初始化完成！');
  }
  
  // 运行单个数据库迁移
  static runMigration(databaseId: string, migrationName: string) {
    try {
      const dbPath = this.getDatabasePath(databaseId);
      const schemaPath = join(this.prismaDir, 'schema.prisma');
      
      // 创建数据库目录（如果不存在）
      const dbDir = join(this.prismaDir, 'tenants');
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }
      
      // 设置数据库URL环境变量
      const env = { ...process.env };
      env.DATABASE_URL = `file:${dbPath}`;
      
      // 执行Prisma迁移
      execSync(`npx prisma db push --schema=${schemaPath}`, {
        env,
        stdio: 'inherit',
        cwd: this.prismaDir
      });
      
      console.log(`   ✅ ${databaseId} 迁移成功`);
      
    } catch (error) {
      console.error(`   ❌ ${databaseId} 迁移失败:`, error.message);
      throw error;
    }
  }
  
  // 获取数据库文件路径
  static getDatabasePath(databaseId: string): string {
    if (databaseId === 'main') {
      return join(this.prismaDir, 'main.db');
    }
    return join(this.prismaDir, 'tenants', `${databaseId}.db`);
  }
  
  // 生成所有数据库
  static generateAllDatabases() {
    console.log('🔧 生成所有数据库架构...\n');
    
    // 生成主数据库
    console.log('📦 生成主数据库架构...');
    this.generatePrismaClient(MAIN_DATABASE);
    
    // 生成经销商数据库
    DEALER_DATABASES.forEach(dealerId => {
      console.log(`🏢 生成经销商数据库架构: ${dealerId}...`);
      this.generatePrismaClient(dealerId);
    });
    
    console.log('\n✅ 所有数据库架构生成完成！');
  }
  
  // 生成Prisma Client
  static generatePrismaClient(databaseId: string) {
    try {
      const dbPath = this.getDatabasePath(databaseId);
      const env = { ...process.env };
      env.DATABASE_URL = `file:${dbPath}`;
      
      execSync('npx prisma generate', {
        env,
        stdio: 'pipe',
        cwd: __dirname
      });
      
      console.log(`   ✅ ${databaseId} Client生成成功`);
      
    } catch (error) {
      console.error(`   ❌ ${databaseId} Client生成失败:`, error.message);
    }
  }
  
  // 创建新的经销商数据库
  static createNewDealerDatabase(dealerId: string) {
    console.log(`🆕 创建新的经销商数据库: ${dealerId}...`);
    
    if (DEALER_DATABASES.includes(dealerId)) {
      console.log(`   ⚠️ 经销商 ${dealerId} 已存在`);
      return;
    }
    
    this.runMigration(dealerId, `init_${dealerId}`);
    console.log(`   ✅ 经销商 ${dealerId} 创建成功`);
    
    // 添加到配置中
    DEALER_DATABASES.push(dealerId);
  }
  
  // 显示数据库状态
  static showDatabaseStatus() {
    console.log('📊 多租户数据库状态:\n');
    
    console.log('🏠 主数据库:');
    console.log(`   📁 路径: ${this.getDatabasePath(MAIN_DATABASE)}`);
    console.log(`   🔗 URL: file:${this.getDatabasePath(MAIN_DATABASE)}`);
    
    console.log('\n🏢 经销商数据库:');
    DEALER_DATABASES.forEach(dealerId => {
      const dbPath = this.getDatabasePath(dealerId);
      const exists = existsSync(join(__dirname, dbPath));
      console.log(`   📁 ${dealerId}: ${exists ? '✅ 已创建' : '❌ 未创建'} (${dbPath})`);
    });
  }
}

// 命令行接口
const command = process.argv[2];
const argument = process.argv[3];

switch (command) {
  case 'init':
    MultiTenantMigration.initializeAllDatabases();
    break;
    
  case 'generate':
    MultiTenantMigration.generateAllDatabases();
    break;
    
  case 'create':
    if (!argument) {
      console.error('❌ 请提供经销商ID，例如: npm run db:create dealer_shanghai');
      process.exit(1);
    }
    MultiTenantMigration.createNewDealerDatabase(argument);
    break;
    
  case 'status':
    MultiTenantMigration.showDatabaseStatus();
    break;
    
  default:
    console.log(`
🚀 多租户数据库管理工具

使用方法:
  npm run db:init       初始化所有数据库
  npm run db:generate   生成所有Prisma Client
  npm run db:create <id> 创建新的经销商数据库
  npm run db:status     显示数据库状态

示例:
  npm run db:init
  npm run db:create dealer_shanghai
  npm run db:status
    `);
    break;
}
