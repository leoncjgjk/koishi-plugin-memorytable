# koishi-plugin-memorytable
[![npm](https://img.shields.io/npm/v/koishi-plugin-memorytable?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memorytable)

一个为Koishi机器人提供记忆表格功能的插件。通过该插件，机器人可以记录与用户的聊天历史，并生成用户特征和记忆信息。

## 功能特点

- 记录用户聊天历史（以群id+用户id为key保存）
- 生成用户特征（可自定义，默认为性别、称呼、印象、好感度、事件）
- 生成短期记忆和长期记忆
- 所有数据处理在本插件内部进行，其他插件直接调用API即可获取记忆数据；可通过传入机器人的对话内容来增强记忆生成效果
- 支持群聊和私聊场景
- 支持记忆数据的备份和恢复

## 更新记录
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

### mem.say <content:text>
复述用户输入的内容。
- `content`: 要复述的文本内容。
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
