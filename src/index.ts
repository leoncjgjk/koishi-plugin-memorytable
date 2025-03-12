import { Context, Schema, Session } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'

export const name = 'memorytable'

export interface Config {
  maxMessages?: number
  apiEndpoint?: string
  apiKey?: string
  model?: string
  autoUpdate?: boolean
  updateInterval?: number
  memoryTemplate?: Record<string, string>
  autoBackup?: boolean
  backupInterval?: number
  maxBackups?: number
}

export const Config: Schema<Config> = Schema.object({
  maxMessages: Schema.number()
    .default(10)
    .description('每个用户存储的最大消息数量'),
  apiEndpoint: Schema.string()
    .default('https://api.openai.com/v1/chat/completions')
    .description('OpenAI兼容API的端点URL'),
  apiKey: Schema.string()
    .role('secret')
    .description('OpenAI API密钥'),
  model: Schema.string()
    .default('gpt-3.5-turbo')
    .description('使用的模型名称'),
  autoUpdate: Schema.boolean()
    .default(false)
    .description('是否自动更新记忆表'),
  updateInterval: Schema.number()
    .default(5)
    .description('自动更新记忆表的间隔（消息数）'),
  memoryTemplate: Schema.dict(Schema.string())
    .description('记忆模板，键为记忆项，值为提示词')
    .default({
      '性别': '根据聊天记录，推断用户的性别是什么？',
      '称呼': '根据聊天记录，我应该如何称呼用户？',
      '印象': '根据聊天记录，总结一下用户给你的印象',
      '好感度': '根据聊天记录，用-100到100的数字表示你对用户的好感度'
    }),
  autoBackup: Schema.boolean()
    .default(false)
    .description('是否启用自动备份功能'),
  backupInterval: Schema.number()
    .default(6)
    .description('自动备份的时间间隔（小时）'),
  maxBackups: Schema.number()
    .default(28)
    .description('保存的最大备份数量')
})

// 定义数据库表结构
declare module 'koishi' {
  interface Tables {
    memory_table: MemoryTableEntry
    group_memory_table: GroupMemoryTableEntry
  }
}

// 消息记录结构
export interface MessageEntry {
  message_id: string
  content: string
  sender_id: string
  sender_name: string
  timestamp: Date
}

// 记忆表结构
export interface MemoryTableEntry {
  id: number
  user_id: string
  platform: string
  next_update: number
  memory: Record<string, any>
  history: MessageEntry[]
  created_at: Date
  updated_at: Date
}

// 群聊记忆表结构
export interface GroupMemoryTableEntry {
  id: number
  group_id: string
  platform: string
  next_update: number
  memory: Record<string, any>
  history: MessageEntry[]
  created_at: Date
  updated_at: Date
}

// 服务类，提供给其他插件使用的API
export class MemoryTableService {
  static inject = ['database']
  public database
  private backupTimer: NodeJS.Timeout
  private backupDir: string

  constructor(private ctx: Context, private config: Config) {
    this.database = ctx.database
    if (!this.database) {
      ctx.logger.warn('Database is not available yet.');
    } else {
      ctx.logger.info('Database is available.');
    }

    // 初始化备份目录
    this.backupDir = path.resolve(__dirname, '../backup')
    this.ensureBackupDir()

    // 如果启用了自动备份，设置定时器
    if (this.config.autoBackup) {
      this.setupBackupTimer()
    }
  }

  // 获取用户的记忆表
  async getUserMemory(userId: string, platform: string): Promise<Record<string, any> | null> {
    const entries = await this.database.get('memory_table', { user_id: userId, platform })
    return entries.length > 0 ? entries[0].memory : null
  }

  // 获取用户的聊天历史
  async getChatHistory(userId: string, platform: string, limit?: number, raw: boolean = false): Promise<MessageEntry[]> {
    const entry = await this.database.get('memory_table', { user_id: userId, platform })
    if (!entry || !entry.length) return []

    let history = entry[0].history || []
    if (!raw) {
      history = history.map(msg => ({
        ...msg,
        content: msg.content.replace(/<img[^>]*>|<at[^>]*>/g, '')
      }))
    }

    return limit ? history.slice(-limit) : history
  }

  // 获取群聊的聊天历史
  async getGroupChatHistory(groupId: string, platform: string, limit?: number, raw: boolean = false): Promise<MessageEntry[]> {
    const entry = await this.getGroupMemory(groupId, platform)
    if (!entry) return []

    let history = entry.history || []
    if (!raw) {
      history = history.map(msg => ({
        ...msg,
        content: msg.content.replace(/<img[^>]*>|<at[^>]*>/g, '')
      }))
    }

    return limit ? history.slice(-limit) : history
  }

  // 清除群聊的所有记录
  async clearGroupData(groupId: string, platform: string): Promise<void> {
    await this.database.remove('group_memory_table', { group_id: groupId, platform })
  }

  // 清除用户的所有记录
  async clearUserData(userId: string, platform: string): Promise<void> {
    await this.database.remove('memory_table', { user_id: userId, platform })
  }

  // 私有方法
  private async getGroupMemory(groupId: string, platform: string): Promise<GroupMemoryTableEntry | null> {
    const entries = await this.database.get('group_memory_table', { group_id: groupId, platform })
    return entries.length > 0 ? entries[0] : null
  }

  private async updateUserMemory(userId: string, platform: string, memory: Record<string, any>): Promise<void> {
    const entries = await this.database.get('memory_table', { user_id: userId, platform })
    if (!entries || entries.length === 0) return

    const entry = entries[0]
    const nextUpdate = (entry.next_update || 0) - 1

    await this.database.set('memory_table', { id: entry.id }, {
      memory,
      next_update: nextUpdate,
      updated_at: new Date()
    })

    if (nextUpdate <= 0 && this.config.autoUpdate && this.config.apiKey) {
      await this.updateMemoryWithAI(userId, platform)
      await this.setNextUpdate(userId, platform, this.config.updateInterval || 5)
    }
  }

  async addChatHistory(userId: string, platform: string, content: string, sender_name?: string, groupId?: string): Promise<void> {
    const messageEntry: MessageEntry = {
      message_id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
      content,
      sender_id: userId,
      sender_name: sender_name || userId,
      timestamp: new Date()
    }

    // 获取完整的用户记录，而不仅仅是memory字段
    const entries = await this.database.get('memory_table', { user_id: userId, platform })
    if (entries && entries.length > 0) {
      const entry = entries[0]
      const history = entry.history || []
      history.push(messageEntry)

      if (this.config.maxMessages && history.length > this.config.maxMessages) {
        history.splice(0, history.length - this.config.maxMessages)
      }

      await this.database.set('memory_table', { id: entry.id }, {
        history,
        updated_at: new Date()
      })
    }

    if (groupId) {
      await this.addGroupChatHistory(groupId, platform, messageEntry)
    }
  }

  private async setNextUpdate(userId: string, platform: string, nextUpdate: number): Promise<void> {
    const entries = await this.database.get('memory_table', { user_id: userId, platform })
    if (!entries || entries.length === 0) return

    const entry = entries[0]
    await this.database.set('memory_table', { id: entry.id }, {
      next_update: nextUpdate,
      updated_at: new Date()
    })
  }

  private async addGroupChatHistory(groupId: string, platform: string, message: MessageEntry): Promise<void> {
    const entry = await this.getGroupMemory(groupId, platform)

    if (entry) {
      const history = entry.history || []
      history.push(message)

      if (this.config.maxMessages && history.length > this.config.maxMessages) {
        history.splice(0, history.length - this.config.maxMessages)
      }

      await this.database.set('group_memory_table', { id: entry.id }, {
        history,
        updated_at: new Date()
      })
    }
  }

  private async updateMemoryWithAI(userId: string, platform: string): Promise<void> {
    const entries = await this.database.get('memory_table', { user_id: userId, platform })
    if (!entries || entries.length === 0 || !this.config.apiKey) return

    const entry = entries[0]
    const history = entry.history || []
    if (history.length === 0) return

    const memory: Record<string, any> = {}
    const template = this.config.memoryTemplate || {}

    try {
      const historyStrings = history.map(entry => `${entry.sender_name}: ${entry.content}`);

      for (const [key, prompt] of Object.entries(template)) {
        const response = await this.callOpenAI(historyStrings, prompt);
        if (response) {
          memory[key] = response.trim();
        }
      }

      if (Object.keys(memory).length > 0) {
        await this.updateUserMemory(userId, platform, memory);
      }
    } catch (error) {
      this.ctx.logger.error(`更新记忆失败: ${error.message}`);
    }
  }

  // 调用OpenAI API
  private async callOpenAI(history: string[], prompt: string): Promise<string> {
    try {
      // 准备消息
      const messages = [
        { role: 'system', content: `你是一个分析聊天记录的助手。${prompt}` },
        { role: 'user', content: `以下是聊天记录，请分析并简洁回答：\n${history.join('\n')}` }
      ]

      // 调用API
      const response = await fetch(this.config.apiEndpoint || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.7,
          max_tokens: 150
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`API请求失败: ${error}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content?.trim() || ''
    } catch (error) {
      this.ctx.logger.error(`调用OpenAI API失败: ${error.message}`)
      return ''
    }
  }

  // 备份相关方法
  private ensureBackupDir(): void {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true })
        this.ctx.logger.info(`创建备份目录: ${this.backupDir}`)
      }
    } catch (error) {
      this.ctx.logger.error(`创建备份目录失败: ${error.message}`)
    }
  }

  private setupBackupTimer(): void {
    // 清除现有的定时器
    if (this.backupTimer) {
      clearInterval(this.backupTimer)
    }

    // 设置新的定时器，间隔为小时转毫秒
    const interval = (this.config.backupInterval || 6) * 60 * 60 * 1000
    this.backupTimer = setInterval(() => this.createAutoBackup(), interval)
    this.ctx.logger.info(`自动备份已启用，间隔: ${this.config.backupInterval}小时`)
  }

  private async createAutoBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(this.backupDir, timestamp)

      await this.createBackup(backupPath)
      await this.cleanupOldBackups()

      this.ctx.logger.info(`自动备份已创建: ${backupPath}`)
      return backupPath
    } catch (error) {
      this.ctx.logger.error(`自动备份失败: ${error.message}`)
      return null
    }
  }

  async createManualBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(this.backupDir, `manual-${timestamp}`)

      await this.createBackup(backupPath)
      this.ctx.logger.info(`手动备份已创建: ${backupPath}`)
      return backupPath
    } catch (error) {
      this.ctx.logger.error(`手动备份失败: ${error.message}`)
      throw error
    }
  }

  private async createBackup(backupPath: string): Promise<void> {
    // 创建备份目录
    fs.mkdirSync(backupPath, { recursive: true })

    // 备份memory_table表
    const memoryTableData = await this.database.get('memory_table', {})
    fs.writeFileSync(
      path.join(backupPath, 'memory_table.json'),
      JSON.stringify(memoryTableData, null, 2)
    )

    // 备份group_memory_table表
    const groupMemoryTableData = await this.database.get('group_memory_table', {})
    fs.writeFileSync(
      path.join(backupPath, 'group_memory_table.json'),
      JSON.stringify(groupMemoryTableData, null, 2)
    )

    // // 备份配置信息
    // fs.writeFileSync(
    //   path.join(backupPath, 'config.json'),
    //   JSON.stringify(this.config, null, 2)
    // )
  }

  private async cleanupOldBackups(): Promise<void> {
    try {
      // 只清理自动备份，不清理手动备份
      const files = fs.readdirSync(this.backupDir)
        .filter(file => !file.startsWith('manual-'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          time: fs.statSync(path.join(this.backupDir, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time) // 按时间降序排序

      const maxBackups = this.config.maxBackups || 28

      // 如果备份数量超过最大值，删除最旧的备份
      if (files.length > maxBackups) {
        const toDelete = files.slice(maxBackups)
        for (const file of toDelete) {
          this.deleteBackupFolder(file.path)
          this.ctx.logger.info(`已删除旧备份: ${file.name}`)
        }
      }
    } catch (error) {
      this.ctx.logger.error(`清理旧备份失败: ${error.message}`)
    }
  }

  private deleteBackupFolder(folderPath: string): void {
    try {
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
        for (const file of files) {
          fs.unlinkSync(path.join(folderPath, file))
        }
        fs.rmdirSync(folderPath)
      }
    } catch (error) {
      this.ctx.logger.error(`删除备份文件夹失败: ${folderPath}, ${error.message}`)
    }
  }

  // 获取所有备份列表，按手动>自动、时间近>远排序
  async getBackupList(): Promise<{name: string, path: string, time: number, isManual: boolean}[]> {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return []
      }

      const files = fs.readdirSync(this.backupDir)
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          time: fs.statSync(path.join(this.backupDir, file)).mtime.getTime(),
          isManual: file.startsWith('manual-')
        }))
        // 首先按手动/自动排序，然后按时间降序排序
        .sort((a, b) => {
          if (a.isManual !== b.isManual) {
            return a.isManual ? -1 : 1 // 手动备份优先
          }
          return b.time - a.time // 时间近的优先
        })

      return files
    } catch (error) {
      this.ctx.logger.error(`获取备份列表失败: ${error.message}`)
      return []
    }
  }

  // 恢复指定的备份
  async restoreBackup(backupPath: string): Promise<boolean> {
    try {
      // 检查备份路径是否存在
      if (!fs.existsSync(backupPath)) {
        this.ctx.logger.error(`备份路径不存在: ${backupPath}`)
        return false
      }

      // 检查备份文件是否存在
      const memoryTableBackupPath = path.join(backupPath, 'memory_table.json')
      const groupMemoryTableBackupPath = path.join(backupPath, 'group_memory_table.json')

      if (!fs.existsSync(memoryTableBackupPath) || !fs.existsSync(groupMemoryTableBackupPath)) {
        this.ctx.logger.error(`备份文件不完整: ${backupPath}`)
        return false
      }

      // 读取备份数据
      const memoryTableData = JSON.parse(fs.readFileSync(memoryTableBackupPath, 'utf8'))
      const groupMemoryTableData = JSON.parse(fs.readFileSync(groupMemoryTableBackupPath, 'utf8'))

      // 清空当前数据库表
      await this.database.remove('memory_table', {})
      await this.database.remove('group_memory_table', {})

      // 恢复数据
      if (memoryTableData && memoryTableData.length > 0) {
        for (const entry of memoryTableData) {
          // 移除id字段，让数据库自动生成新的id
          const { id, ...data } = entry
          await this.database.create('memory_table', data)
        }
      }

      if (groupMemoryTableData && groupMemoryTableData.length > 0) {
        for (const entry of groupMemoryTableData) {
          // 移除id字段，让数据库自动生成新的id
          const { id, ...data } = entry
          await this.database.create('group_memory_table', data)
        }
      }

      this.ctx.logger.info(`成功恢复备份: ${path.basename(backupPath)}`)
      return true
    } catch (error) {
      this.ctx.logger.error(`恢复备份失败: ${error.message}`)
      return false
    }
  }

  // 停止备份定时器
  dispose(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer)
      this.backupTimer = null
    }
  }
}

// 插件主体
export function apply(ctx: Context, config: Config) {
  // 检查配置
  if (config.autoUpdate && !config.apiKey) {
    ctx.logger.warn('启用了自动更新但未提供API密钥，自动更新功能将不可用')
  }

  // 检查备份配置
  if (config.autoBackup) {
    ctx.logger.info(`已启用自动备份功能，间隔: ${config.backupInterval}小时，最大备份数: ${config.maxBackups}`)
  }

  // 注册数据库表
  ctx.model.extend('memory_table', {
    id: 'unsigned',
    user_id: 'string',
    platform: 'string',
    next_update: 'integer',
    memory: 'json',
    history: 'json',
    created_at: 'timestamp',
    updated_at: 'timestamp'
  }, {
    primary: 'id',
    autoInc: true,
    unique: [['user_id', 'platform']],
  })

  // 注册群聊数据库表
  ctx.model.extend('group_memory_table', {
    id: 'unsigned',
    group_id: 'string',
    platform: 'string',
    next_update: 'integer',
    memory: 'json',
    history: 'json',
    created_at: 'timestamp',
    updated_at: 'timestamp'
  }, {
    primary: 'id',
    autoInc: true,
    unique: [['group_id', 'platform']],
  })

  // 注册服务
  const service = new MemoryTableService(ctx, config)

  // 监听消息事件
  ctx.on('message', async (session: Session) => {
    const userId = session.userId
    const platform = session.platform
    const content = session.content
    const sender = session.username || userId
    ctx.logger.info(`收到消息: ${content}`)

    // 检查是否为指令消息，如果是则不记录
    if (content.startsWith('mem.')) {
      return
    }

    try {
      // 检查用户是否存在
      const entries = await service.getUserMemory(userId, platform)

      // 如果用户不存在，创建新用户记录
      if (!entries) {
        await ctx.database.create('memory_table', {
          user_id: userId,
          platform,
          next_update: 5,
          memory: {},
          history: [{
            message_id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
            content: content,
            sender_id: userId,
            sender_name: sender,
            timestamp: new Date()
          }],
          created_at: new Date(),
          updated_at: new Date()
        })
      } else {
        // 添加消息到历史记录
        await service.addChatHistory(userId, platform, content, sender)
      }
    } catch (error) {
      ctx.logger.error(`处理消息时发生错误: ${error.message}`)
    }
  })

  // 注册指令
  ctx.command('mem.memory [userId:string]', '查看用户的记忆数据')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      const targetId = userId || session.userId
      const memory = await service.getUserMemory(targetId, session.platform)
      if (!memory) return '没有记忆数据'
      return JSON.stringify(memory, null, 2)
    })

  ctx.command('mem.history [userId:string] [limit:number]', '查看用户的聊天历史')
    .userFields(['authority'])
    .action(async ({ session }, userId, limit) => {
      const targetId = userId || session.userId
      const history = await service.getChatHistory(targetId, session.platform, limit)
      if (history.length === 0) return '没有聊天历史'
      return history.map(msg => `${msg.sender_name}: ${msg.content}`).join('\n')
    })

  ctx.command('mem.group-history <groupId:string> [limit:number]', '查看群聊的聊天历史')
    .userFields(['authority'])
    .action(async ({ session }, groupId, limit) => {
      const history = await service.getGroupChatHistory(groupId, session.platform, limit)
      if (history.length === 0) return '没有群聊历史'
      return history.map(msg => `${msg.sender_name}: ${msg.content}`).join('\n')
    })

  ctx.command('mem.clear-group <groupId:string>', '清除群聊的所有记录')
    .userFields(['authority'])
    .action(async ({ session }, groupId) => {
      await service.clearGroupData(groupId, session.platform)
      return '已清除群聊的所有记录'
    })

  ctx.command('mem.clear [userId:string]', '清除用户的所有记录')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      const targetId = userId || session.userId
      await service.clearUserData(targetId, session.platform)
      return '已清除用户的所有记录'
    })

  // 添加备份相关命令
  ctx.command('mem.backup', '手动创建数据备份')
    .userFields(['authority'])
    .action(async ({ session }) => {
      try {
        const backupPath = await service.createManualBackup()
        return `备份已创建: ${path.basename(backupPath)}`
      } catch (error) {
        return `备份创建失败: ${error.message}`
      }
    })

  // 添加恢复备份命令
  ctx.command('mem.restore', '恢复数据备份')
    .userFields(['authority'])
    .action(async ({ session }) => {
      try {
        // 获取所有备份列表
        const backups = await service.getBackupList()

        if (backups.length === 0) {
          return '没有找到可用的备份'
        }

        // 格式化备份列表显示
        const backupList = backups.map((backup, index) => {
          const date = new Date(backup.time).toLocaleString('zh-CN')
          const type = backup.isManual ? '手动备份' : '自动备份'
          return `${index + 1}. ${type} - ${date} (${backup.name})`
        }).join('\n')

        await session.send('请选择要恢复的备份序号:\n' + backupList + '\n输入0取消操作')
        // 创建一个会话状态，等待用户输入
        const chosen = await session.prompt(30000)

        // 如果用户没有输入（超时），则退出恢复流程
        if (chosen === null) {
          return '恢复操作已取消：等待输入超时'
        }

        // 检查用户输入
        const index = parseInt(chosen as string) - 1
        if (isNaN(index) || index < 0 || index >= backups.length) {
          return '无效的序号，恢复操作已取消'
        }

        // 先创建当前数据的备份
        await service.createManualBackup()

        // 恢复选择的备份
        const result = await service.restoreBackup(backups[index].path)

        if (result) {
          return `已成功恢复备份: ${backups[index].name}`
        } else {
          return `恢复备份失败: ${backups[index].name}`
        }
      } catch (error) {
        return `恢复备份操作失败: ${error.message}`
      }
    })

  // 注册dispose方法，在插件卸载时清理资源
  ctx.on('dispose', () => {
    if (service.dispose) {
      service.dispose()
    }
  })

  // 返回服务实例
  return service
}

