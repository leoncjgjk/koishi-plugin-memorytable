# koishi-plugin-memorytable

[![npm](https://img.shields.io/npm/v/koishi-plugin-memorytable?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memorytable)

为其他bot插件提供记忆表格功能，可以存储用户的聊天记录和并可通过大模型分析总结出重要数据。

## 功能特点

- 自动记录用户的聊天内容
- 提供API接口供其他插件获取用户的聊天记录和记忆数据
- 支持配置每个用户的最大消息存储数量
- 支持设置下次更新记忆的时间
- 按照模板格式存储用户数据

## 配置项

- `maxMessages`: 每个用户存储的最大消息数量，默认为100条

## 服务API

该插件提供了`MemoryTableService`服务，可以被其他插件调用：

```typescript
declare module 'koishi' {
  interface Context {
    memorytable: MemoryTableService
  }
}
```

### API方法

#### getUserMemory

获取用户的记忆表数据。

```typescript
async getUserMemory(userId: string, platform: string): Promise<MemoryTableEntry | null>
```

#### updateUserMemory

更新用户的记忆数据。

```typescript
async updateUserMemory(userId: string, platform: string, memory: Record<string, any>): Promise<void>
```

#### addChatHistory

添加一条聊天记录到用户历史记录中。

```typescript
async addChatHistory(userId: string, platform: string, message: string): Promise<void>
```

#### getChatHistory

获取用户的聊天历史记录。

```typescript
async getChatHistory(userId: string, platform: string): Promise<string[]>
```

#### setNextUpdate

设置用户记忆的下次更新时间。

```typescript
async setNextUpdate(userId: string, platform: string, nextUpdate: number): Promise<void>
```

#### clearUserData

清除用户的所有记录（包括记忆和聊天历史）。

```typescript
async clearUserData(userId: string, platform: string): Promise<void>
```

## 数据结构

### MemoryTableEntry

```typescript
interface MemoryTableEntry {
  id: number
  user_id: string
  platform: string
  next_update: number
  memory: Record<string, any>
  history: string[]
  created_at: Date
  updated_at: Date
}
```

## 使用示例

```typescript
import { Context } from 'koishi'

export function apply(ctx: Context) {
  // 获取用户的聊天历史
  ctx.command('chat-history')
    .action(async ({ session }) => {
      const history = await ctx.memorytable.getChatHistory(session.userId, session.platform)
      return history.join('\n')
    })

  // 获取用户的记忆数据
  ctx.command('memory')
    .action(async ({ session }) => {
      const entry = await ctx.memorytable.getUserMemory(session.userId, session.platform)
      if (!entry) return '没有记忆数据'
      return JSON.stringify(entry.memory, null, 2)
    })

  // 清除用户的所有数据
  ctx.command('clear-memory')
    .action(async ({ session }) => {
      await ctx.memorytable.clearUserData(session.userId, session.platform)
      return '已清除所有记忆和聊天记录'
    })
}
```

## 数据存储格式

插件按照以下格式存储用户数据：

```json
{
  "[用户ID]": {
    "nextUpdate": 5,
    "memory": {
      "ta的性别（男/女）": "男",
      "你对ta的称呼（<10个字）": "哥哥",
      "你对ta的印象（<15个字）": "我最亲爱的哥哥，对我非常好，可以信赖",
      "你对ta的好感（-100~100）": 100
    },
    "history": [
      "用户名:消息内容",
      "机器人名:回复内容"
    ]
  }
}
```