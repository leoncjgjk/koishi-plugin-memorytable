# koishi-plugin-memorytable

一个为Koishi机器人提供记忆表格功能的插件。通过该插件，机器人可以记录与用户的聊天历史，并生成用户特征和记忆信息。

## 功能特点

- 记录用户聊天历史
- 生成用户特征（性别、称呼、印象、好感度等）
- 支持短期记忆和长期记忆
- 提供API接口供其他插件调用
- 支持群聊和私聊场景
- 支持记忆数据的备份和恢复

## 指令说明
### mem.trait
查看当前用户的特征信息，包括性别、称呼、印象和好感度等。当聊天消息数达到配置的refreshTraitMesNumber时，会自动更新用户特征。
### mem.mem
查看当前用户的记忆信息，包括特征、短期记忆和长期记忆。
### mem.history
查看与当前用户的聊天历史记录。
### mem.backup
手动创建一个记忆数据的备份。
### mem.restore
从指定的备份文件恢复记忆数据。

## 服务API

该插件提供了`MemoryTableService`服务，可以被其他插件调用：

```typescript
declare module 'koishi' {
  interface Context {
    memorytable: MemoryTableService
  }

  interface MemoryTableService {
    getMemory(userId: string, platform: string, groupId?: string): Promise<MemoryTableEntry>
    updateMemory(userId: string, platform: string, groupId: string, memory: Partial<MemoryTableEntry>): Promise<void>
    clearMemory(userId: string, platform: string, groupId?: string): Promise<void>
  }
}
```

### 使用示例

```typescript
export class YourPlugin {
  constructor(ctx: Context, private database: Context['database']) {
    // 获取用户记忆信息
    ctx.middleware(async (session, next) => {
      const { userId, platform } = session
      const groupId = session.guildId || '0' // 私聊时groupId为'0'

      // 使用服务API获取记忆信息
      const memory = await ctx.memorytable.getMemory(userId, platform, groupId)

      if (memory) {
        // 使用记忆信息
        console.log('用户特征:', memory.trait)
        console.log('短期记忆:', memory.memory_st)
        console.log('长期记忆:', memory.memory_lt)
        // 处理你的业务逻辑
      }

      return next()
    })
  }
}
```