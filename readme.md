# koishi-plugin-memorytable
[![npm](https://img.shields.io/npm/v/koishi-plugin-memorytable?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memorytable)

- 一个为Koishi机器人提供记忆表格功能的插件。通过该插件，机器人可以记录与用户的聊天历史，并生成用户特征和记忆信息。
- 也可以独立使用自带的娱乐指令（例如鉴定伪人、吃瓜）

## 功能特点

- 记录用户聊天历史（以群id+用户id为key保存）
- 生成用户特征（可自定义，默认为性别、称呼、印象、好感度、事件）
- 生成短期记忆和长期记忆
- 所有数据处理在本插件内部进行，其他插件直接调用API即可获取记忆数据；可通过传入机器人的对话内容来增强记忆生成效果
- 支持群聊和私聊场景
- 支持记忆数据的备份和恢复
- 一些其他需要利用聊天记录完成的娱乐功能，比如吃瓜和鉴定伪人（笑）

## 更新记录
### v1.4.7
- 伪人指令增加id转昵称
- 优化trait生成的提示词模板，以及id转昵称
- 修复群聊原始记录保存上限错误的问题
- 增加一些工具函数，吃瓜2指令调用时可传入时间,并且智能判断是否在聊天记录内添加id
- hotfix伪人指令消息类型错误
- 吃瓜2指令时间参数改为字符串，支持a和a,b格式，过滤0~a分钟或a到b分钟的内容
- 优化吃瓜2指令逻辑，优化内置指令的prompt
- 增加新手教程配置说明
- hotfix吃瓜2指令兼容AI的两种理解，优化指令和处理方式
### v1.4.3
- 增加特征功能私聊的开关，娱乐功能的开关和一些参数设置
- 修复有人退群后查看好感排行榜报错的问题
- 优化插件主界面
- 增加分群的botPrompt设置
- （实验性）可配置过滤指令名，不加入群聊记录
- 修复部分来源的空消息未过滤掉的问题
- 短期记忆和长期记忆中@id转化为昵称
- 吃瓜2指令增加参数userid，只过滤对应用户的聊天消息,多个id可用逗号分隔
- hotfix 日志报错
### v1.3.9
- 增加群聊总结指令，方便吃瓜；2个总结指令，分别是吃瓜和吃瓜2
- 优化一些设置
- 增加日志开关
- 增加常用指令说明
### v1.3.5
- 增加娱乐功能，伪人测试。
- 如果填写了botPrompt，伪人测试会以此视角分析并总结。
### v1.3.3
- 增加知识库功能，可额外配置关键词触发知识库查询。
- 支持额外知识库文件的配置。
### v1.3.0
- （实验性）增加机器人人设功能，在生成记忆时可以基于机器人视角分析。
### v1.2.3
- 优化设置选项及默认设置。
- 长短期记忆优化开关功能。
- （实验性）对聊天记录中的url进行简化
### v1.2.2
- 开放短期记忆的自定义配置
### v1.2.1
- 优化设置分类
### v1.2.0
- 扩展trait为traits，支持同时查询多人trait
### v1.1.4
- 完整适配oob，支持切换人设自动清除记录
### v1.1.0
- 完成短期记忆和长期记忆模块
### v1.0.0
- 稳定版本，支持查询个人trait

====================================================================================================================================
## 指令说明
### mem.setTrait <trait:string> [groupid:number] [userid:number]
设置当前用户的特征信息，包括性别、称呼、印象和好感度等。
- `trait`: 特征信息字符串，格式为 `key: value`，每行一个特征。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。
- `userid`: 用户ID，默认为当前会话的用户ID。

### mem.trait [groupid:number] [userid:number]
查看当前用户的特征信息，包括性别、称呼、印象和好感度等。当聊天消息数达到配置的 traitMesNumber 时，会自动更新用户特征。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。
- `userid`: 用户ID，默认为当前会话的用户ID。

### mem.mem [groupid:number] [userid:number]
查看当前用户的记忆信息，包括特征、短期记忆和长期记忆。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。
- `userid`: 用户ID，默认为当前会话的用户ID。

### mem.history [groupid:number] [userid:number]
查看与当前用户的聊天历史记录。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。
- `userid`: 用户ID，默认为当前会话的用户ID。

### mem.backup
手动创建一个记忆数据的备份。

### mem.restore
从指定的备份文件恢复记忆数据。

### mem.likeRank [groupid:number]
查看当前群组的好感度排行榜。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。

### mem.like [groupid:number] [userid:number]
查看当前用户的好感度。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。
- `userid`: 用户ID，默认为当前会话的用户ID。

### mem.dislikeRank [groupid:number]
查看当前群组的差评排行榜。
- `groupid`: 群组ID，默认为当前会话的群组ID或频道ID，私聊时为 `0`。

### mem.human [mes:number]
娱乐功能：调用最近x条聊天记录，判定其中每个人的伪人概率
- `mes`: 聊天记录条数，默认10条。10~100.

### mem.summarize [extraPrompt:string]
娱乐功能：总结最近群里在说什么，可自己写prompt以要求AI进行针对性回答，例如："吃瓜 刚才有几个人复读了？"、"吃瓜 刚才都是谁在吵架？谁起的头？"。
- `extraPrompt`: 替换默认的prompt。

====================================================================================================================================
## API说明
### API: getMem(userId: string, groupId: string)
获取指定用户的记忆信息，包括特征、短期记忆和长期记忆。
- `userId`: 用户ID。
- `groupId`: 群组ID，私聊时为 `0`或`private:userId`。

### API: setMemBotMes(session: Session, content: string, authID: string)
传入机器人消息以更新聊天记录。（可能自动获取不到机器人的消息记录，需要通过这个API传入）
- `session`: 当前会话的 Session 对象。
- `content`: 消息内容。
- `authID`: 要回复的用户ID。

### API：clearMem(autoBackup : boolean = true)
清除当前所有记忆数据。
- `autoBackup`: 是否自动备份记忆数据，默认为 `true`。

### API: clearTrait(session: Session)
清除当前用户的特征信息。
- `session`: 当前会话的 Session 对象。
