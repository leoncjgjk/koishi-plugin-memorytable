import { Context, Schema, Session } from 'koishi'

export const name = 'memorytable'

export interface Config {
  maxMessages?: number
  apiEndpoint?: string
  apiKey?: string
  model?: string
  autoUpdate?: boolean
  updateInterval?: number
  memoryTemplate?: Record<string, string>
}

export const Config: Schema<Config> = Schema.object({
  maxMessages: Schema.number().default(100).description('每个用户存储的最大消息数量'),
  apiEndpoint: Schema.string().default('https://api.openai.com/v1/chat/completions').description('OpenAI兼容API的端点URL'),
  apiKey: Schema.string().role('secret').description('OpenAI API密钥'),
  model: Schema.string().default('gpt-3.5-turbo').description('使用的模型名称'),
  autoUpdate: Schema.boolean().default(false).description('是否自动更新记忆表'),
  updateInterval: Schema.number().default(10).description('自动更新记忆表的间隔（消息数）'),
  memoryTemplate: Schema.dict(Schema.string()).description('记忆模板，键为记忆项，值为提示词').default({
    '性别': '根据聊天记录，推断用户的性别是什么？',
    '称呼': '根据聊天记录，我应该如何称呼用户？',
    '印象': '根据聊天记录，总结一下用户给你的印象',
    '好感度': '根据聊天记录，用-100到100的数字表示用户对你的好感度'
  })
})

// 定义数据库表结构
declare module 'koishi' {
  interface Tables {
    memory_table: MemoryTableEntry
  }
}

// 记忆表结构
export interface MemoryTableEntry {
  id: number
  user_id: string
  platform: string
  next_update: number
  memory: Record<string, any>
  history: string[]
  created_at: Date
  updated_at: Date
}

// 服务类，提供给其他插件使用的API
export class MemoryTableService {
  constructor(private ctx: Context, private config: Config) {
    // 如果启用了自动更新，设置定时任务
    if (this.config.autoUpdate) {
      this.setupAutoUpdate()
    }
  }

  // 获取用户的记忆表
  async getUserMemory(userId: string, platform: string): Promise<MemoryTableEntry | null> {
    const entries = await this.ctx.database.get('memory_table', { user_id: userId, platform })
    return entries.length > 0 ? entries[0] : null
  }

  // 更新用户的记忆表
  async updateUserMemory(userId: string, platform: string, memory: Record<string, any>): Promise<void> {
    const entry = await this.getUserMemory(userId, platform)

    if (entry) {
      await this.ctx.database.set('memory_table', { id: entry.id }, {
        memory,
        updated_at: new Date()
      })
    }
  }

  // 添加聊天记录
  async addChatHistory(userId: string, platform: string, message: string): Promise<void> {
    const entry = await this.getUserMemory(userId, platform)

    if (entry) {
      const history = entry.history || []
      history.push(message)

      // 如果配置了最大消息数，则删除多余的消息
      if (this.config.maxMessages && history.length > this.config.maxMessages) {
        history.splice(0, history.length - this.config.maxMessages)
      }

      await this.ctx.database.set('memory_table', { id: entry.id }, {
        history,
        updated_at: new Date()
      })
    }
  }

  // 获取用户的聊天历史
  async getChatHistory(userId: string, platform: string): Promise<string[]> {
    const entry = await this.getUserMemory(userId, platform)
    return entry ? entry.history || [] : []
  }

  // 设置下次更新时间
  async setNextUpdate(userId: string, platform: string, nextUpdate: number): Promise<void> {
    const entry = await this.getUserMemory(userId, platform)

    if (entry) {
      await this.ctx.database.set('memory_table', { id: entry.id }, {
        next_update: nextUpdate,
        updated_at: new Date()
      })
    }
  }

  // 清除用户的所有记录
  async clearUserData(userId: string, platform: string): Promise<void> {
    await this.ctx.database.remove('memory_table', { user_id: userId, platform })
  }

  // 设置自动更新
  private setupAutoUpdate() {
    this.ctx.on('message', async (session: Session) => {
      const userId = session.userId
      const platform = session.platform

      // 获取用户记录
      const entry = await this.getUserMemory(userId, platform)
      if (!entry) return

      // 检查是否需要更新记忆
      if (entry.history?.length >= entry.next_update && this.config.apiKey) {
        // 更新记忆
        await this.updateMemoryWithAI(userId, platform)

        // 设置下一次更新时间
        const nextUpdate = (entry.history?.length || 0) + (this.config.updateInterval || 0)
        await this.setNextUpdate(userId, platform, nextUpdate)
      }
    })
  }

  // 使用AI更新记忆
  async updateMemoryWithAI(userId: string, platform: string): Promise<void> {
    const entry = await this.getUserMemory(userId, platform)
    if (!entry || !this.config.apiKey) return

    const history = entry.history || []
    if (history.length === 0) return

    const memory: Record<string, any> = {}
    const template = this.config.memoryTemplate || {}

    try {
      // 为每个记忆项生成内容
      for (const [key, prompt] of Object.entries(template)) {
        const content = await this.callOpenAI(history, prompt)
        if (content) memory[key] = content
      }

      // 更新记忆
      if (Object.keys(memory).length > 0) {
        await this.updateUserMemory(userId, platform, memory)
      }
    } catch (error) {
      this.ctx.logger.error(`更新记忆失败: ${error.message}`)
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
}

// 插件主体
export function apply(ctx: Context, config: Config) {
  // 检查配置
  if (config.autoUpdate && !config.apiKey) {
    ctx.logger.warn('启用了自动更新但未提供API密钥，自动更新功能将不可用')
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
    unique: [['user_id', 'platform']],
  })

  // 注册服务
  const service = new MemoryTableService(ctx, config)
  ctx.plugin(MemoryTableService, service)

  // 监听消息事件
  ctx.on('message', async (session: Session) => {
    const userId = session.userId
    const platform = session.platform
    const content = session.content
    const sender = session.username || userId
    const messageEntry = `${sender}:${content}`

    // 检查用户是否存在
    const entry = await service.getUserMemory(userId, platform)

    // 如果用户不存在，创建新用户记录
    if (!entry) {
      await ctx.database.create('memory_table', {
        user_id: userId,
        platform,
        next_update: 5,
        memory: {},
        history: [messageEntry],
        created_at: new Date(),
        updated_at: new Date()
      })
    } else {
      // 添加消息到历史记录
      await service.addChatHistory(userId, platform, messageEntry)
    }
  })

  // 返回服务实例
  return service
}