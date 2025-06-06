import { Context, Schema, Session, Service, h } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'

let extraKBs = []
// 扩展Koishi事件系统以支持机器人消息事件
export const name = 'memorytable'
export const usage = `
### 本插件为Koishi机器人提供长期记忆功能，已适配的是koishi-plugin-oobabooga-testbot。其他机器人插件可自行调用getMem函数使用。

## 最近3个版本的更新日志：
### v1.3.3
- 增加知识库功能，可额外配置关键词触发知识库查询。
- 支持额外知识库文件的配置。
### v1.3.0
- （实验性）增加机器人人设功能，在生成记忆时可以基于机器人视角分析。
### v1.2.3
- 优化设置选项及默认设置。
- 长短期记忆优化开关功能。
- （实验性）对聊天记录中的url进行简化
`

export interface Config {
  maxMessages?: number
  apiEndpoint?: string
  apiKey?: string
  model?: string
  enableMemSt?: boolean
  enableMemStApi?: boolean
  memoryStMessages?: number
  memoryStMesNumMax?: number
  memoryStPrompt?: string
  memoryStMesNumUsed?: number
  enableMemLt?: boolean
  enableMemLtApi?: boolean
  memoryLtMessages?: number
  memoryLtPrompt?: string
  traitMesNumberFT?: number
  traitMesNumber?: number
  traitTemplate?: Record<string, string>
  traitCacheNum?: number
  botMesReport?: boolean
  debugMode?: boolean
  botPrompt?: string
  memoryStUseBotPrompt?: boolean
  memoryLtUseBotPrompt?: boolean
  enableExtraKB?: boolean
  knowledgeBooks?: Record<string, string>
  KBExtraPath?: string
  KBMaxNum?: number
  KBExtraFileName?: Record<string, string>
}

export const Config = Schema.intersect([
  Schema.object({
    apiEndpoint: Schema.string()
      .default('https://api.openai.com/v1/chat/completions')
      .description('OpenAI兼容API的端点URL'),
    apiKey: Schema.string()
      .role('secret')
      .description('OpenAI API密钥'),
    model: Schema.string()
      .default('gpt-3.5-turbo')
      .description('使用的模型名称')
  }).description('API设置'),
  Schema.object({
    maxMessages: Schema.number()
      .default(20)
      .description('每个聊天对象保存的聊天记录(每个群单独算，不能少于更新特征用到的数量）'),
    traitMesNumberFT: Schema.number()
      .default(6)
      .description('更新特征读取的聊天记录条数(第一次创建时,此设置暂时无效)'),
    traitMesNumber: Schema.number()
      .default(10)
      .description('更新特征读取的聊天记录条数（后续更新时）'),
    traitTemplate: Schema.dict(Schema.string())
      .description('特征模板，键为特征项，值为提示词。（*提示：直接点击下面特征的名字是可以修改的）')
      .default({
        '称呼': '机器人应该如何称呼用户？',
        '性别': '只允许填：未知/男/女',
        '印象': '总结一下机器人对用户的印象和看法,用形容词，不超过20个字',
        '好感度': '用-100到100的数字表示机器人对用户的好感度',
        '事件':'总结一下机器人和用户之间发生过的印象深刻的事情，不超过50个字'
      }),
    traitCacheNum: Schema.number()
      .default(0)
      .description('特征缓存条数(额外发送最近几个人的特征信息。默认为0，代表只发送当前消息对象的特征信息。)'),
    botPrompt: Schema.string().experimental()
     .default('')
     .description('机器人的人设,用于生成记忆时增加主观性。留空则为第三方客观视角。'),
  }).description('功能1：特征信息设置'),
  Schema.object({
    enableMemSt: Schema.boolean()
      .default(true)
      .description('是否生成新的短期记忆'),
    enableMemStApi: Schema.boolean()
      .default(true)
      .description('是否使用已有的短期记忆（关闭后短期记忆将不会生效）'),
    memoryStMessages: Schema.number()
      .default(30)
      .description('短记忆生成时，用到的聊天记录条数'),
    memoryStMesNumMax: Schema.number()
      .default(10)
      .description('短记忆保留的条数（建议大于下面这个设置2.5倍以上）'),
    memoryStMesNumUsed: Schema.number()
      .default(5)
      .description('短记忆真实使用的条数（发给AI最近x条，生成新的短期记忆也会参考）'),
    memoryStPrompt: Schema.string()
      .default('你是一个聊天记录总结助手，你的任务是根据提供的聊天记录和之前的总结，生成一段新的、简洁的聊天记录总结，记录发生的事情和其中主要人物的行为，而且新的总结不要和之前的总结重复。请直接返回总结内容，不要添加任何解释')
      .description('短期记忆生成用到的提示词'),
    memoryStUseBotPrompt: Schema.boolean().experimental()
    .default(true)
    .description('生成短期记忆时，是否使用机器人人设（botPrompt）。')
  }).description('功能2：短期记忆设置'),
  Schema.object({
    enableMemLt: Schema.boolean()
      .default(false)
      .description('是否生成新的长期记忆(必须先开启短期记忆，否则开了也没用）'),
    enableMemLtApi: Schema.boolean()
    .default(false)
    .description('是否使用已有的长期记忆（关闭后长期记忆将不会生效）'),
    memoryLtMessages: Schema.number()
      .default(30)
      .description('长期记忆生成用到的聊天记录条数（或者叫远期记忆，因为只会使用短期记忆已经使用过的消息生成）'),
    memoryLtPrompt: Schema.string()
      .default('请根据以下聊天记录，更新旧的长期记忆。只保留重要内容，剔除过时的、存疑的、矛盾的内容，不要捏造信息。内容要极其简单明了，不要超过500字。请直接返回总结内容，不要添加任何解释或额外信息。')
      .description('长期记忆生成用到的提示词'),
    memoryLtUseBotPrompt: Schema.boolean().experimental()
      .default(true)
      .description('生成长期记忆时，是否使用机器人人设（botPrompt）。')
  }).description('功能3：长期记忆设置'),
  Schema.object({
    enableKB: Schema.boolean()
      .default(false)
      .description('是否开启知识库功能。'),
      knowledgeBooks: Schema.array(Schema.object(
        {
          keyword: Schema.string().required(),
          content: Schema.string().required()
        }
      ))
      .role('table')
      .description('知识库，键为关键词，值为内容。（关键词可以用逗号隔开，当收到消息中匹配到任意一个关键词，则将对应的内容作为知识库发送给AI。可用于人设补充等。）')
      .default([{keyword: "酒馆,ST",content: "SillyTavern"}]
    ),
    enableExtraKB: Schema.boolean()
      .default(false)
      .description('是否开启额外的知识库功能。插件初始化时会自动提取额外知识库文件。'),

    KBExtraPath: Schema.string()
      .default('')
      .description('额外的知识库路径的目录，填绝对路径。插件会从该目录下的json文件和txt文件中检查，内容格式为{"关键词": "内容"}'),
    KBExtraFileName: Schema.array(Schema.object(
      {
        filename: Schema.string().required()
      }
      ))
      .role('table')
      .description('额外的知识库文件名，填文件名，不带后缀。留空的话会检查所有文件。')
      .default([]),
    KBMaxNum: Schema.number()
     .default(5)
     .description('同时触发知识库的最大条目数')
  }).description('功能4：知识库设置'),
  Schema.object({
    botMesReport: Schema.boolean()
     .default(false)
     .description('是否已开启机器人聊天上报（不知道的开了也没用）'),
    debugMode: Schema.boolean()
     .default(false)
     .description('是否开启调试模式')
  }).description('高级设置')
])

// 定义数据库表结构
declare module 'koishi' {
  interface Tables {
    memory_table: MemoryTableEntry
  }
  interface Context {
    memorytable: MemoryTableService
  }
}
export interface RecentHistories {
	history: MessageEntry[]
}


// 消息记录结构
export interface MessageEntry {
	message_id: string
	content: string
	sender_id: string
	sender_name: string
	timestamp: Date
  used: boolean
}

// 记忆表结构
export interface MemoryTableEntry {
	group_id: string //0代表私聊
	user_id: string //0代表本群聊天总记录
	trait: Record<string, any> //对方特征
	traitBak: Record<string, any> //对方特征
	memory_st: string[] //短期记忆
	memory_lt: string[] //长期记忆，只作为短期记忆和特征生成的参考，并不会发给聊天AI
	history: MessageEntry[]
}

export class MemoryTableService extends Service {
	// 过滤特殊消息内容
	private filterMessageContent(content: string): string {
		// 如果是mem指令，返回空字符串
		if (content.trim().startsWith('mem')) {
			return ''
		}
    content = this.replaceUrlsWithSiteNames(content)

		return content
			.replace(/<img[^>]*\/>/g, '[图片]')
			.replace(/<json[^>]*\/>/g, '')
			.replace(/<audio[^>]*\/>/g, '')
			.replace(/<file[^>]*\/>/g, '')
			.replace(/<forward[^>]*\/>/g, '')
			.replace(/<mface[^>]*\/>/g, '')
			.replace(/<face[^>]*>.*?<\/face>/g, '')
			.replace(/<at[^>]*id="([^"]+)".*?\/>/g, '@$1 ')
			//.replace(/^[a-zA-Z]+:\/\/[^\s]+$/g, '[链接]')
			.trim()
	}

  // 匹配URL
  private replaceUrlsWithSiteNames(text) {
    const urlRegex = /(?:https?|ftp):\/\/[^\s/$.?#]+\.[^\s]*|\bwww\.[^\s]+\.[^\s]*|\b[a-z0-9-]+\.[a-z]{2,}\b(?:\/[^\s]*)?/gi;
    return text.replace(urlRegex, (url) => {
        try {
            // 提取域名部分
            let domain;
            if (url.startsWith('www.')) {
                domain = url.split('/')[0];  // 处理www开头的URL
            } else {
                const urlObj = new URL(url.startsWith('http') ? url : `http://${url}`);
                domain = urlObj.hostname;
            }

            const domainParts = domain.split('.');
            let siteName = domainParts[domainParts.length - 2];  // 提取网站名,通常取倒数第二部分

            // 处理特殊情况（如.co.uk等双后缀域名）
            const tlds = ['co', 'com', 'org', 'net', 'edu', 'gov', 'ac']; // 常见二级后缀
            if (domainParts.length > 2 && tlds.includes(domainParts[domainParts.length - 2])) {
                siteName = domainParts[domainParts.length - 3];
            }
            return `[${siteName}的链接]`;
        } catch (e) {
            return url;
        }
    });
  }

	static inject = ['database']

  private messageQueue: Array<{ userId: string, groupId: string }> = []
  private generatingSummaryFor: Set<string> = new Set()

  constructor(ctx: Context, config: Config & { maxMessages: number }) {
    // 调用 Service 构造函数，注册服务名称
    super(ctx, 'memorytable', true)
    this.config = config
    // 初始化数据库
		ctx.database.extend('memory_table', {
			group_id: 'string',
			user_id: 'string',
			trait: 'json',
			traitBak: 'json',
			memory_st: 'list',
			memory_lt: 'list',
			history: 'json'
		}, {
			primary: ['group_id', 'user_id'],
      autoInc: false,
		})

		// 注册指令
    ctx.command('mem.getTrait [groupid:number] [userid:number]', { authority: 2 })
    .userFields(['authority'])
    .action(async ({ session }, groupid, userid) => {
      const groupId = String(groupid === -1 || !groupid ? session.guildId || session.channelId || '0' : groupid)
      const userId = String(userid || session.userId)

      const memoryEntry = await this.ctx.database.get('memory_table', {
        group_id: groupId,
        user_id: userId
      }).then(entries => entries[0])

      if (!memoryEntry || !memoryEntry.trait) {
        return '暂无特征信息'
      }

      return JSON.stringify(memoryEntry.trait, null, 2)
    })

    // setTrait函数重载
    ctx.command('mem.setTrait <trait:string>', { authority: 2 })
      .userFields(['authority'])
      .action(async ({ session }, trait) => {
        return handleSetTrait.call(this, session, trait)
      })

    ctx.command('mem.setTrait --groupid <groupid:number> --userid <userid:number> <trait:string>', { authority: 2 })
      .userFields(['authority'])
      .action(async ({ session }, groupid, userid, trait) => {
        return handleSetTrait.call(this, session, trait, groupid, userid)
      })

		ctx.command('mem.trait [groupid:number] [userid:number]',{ authority: 2 })
      .userFields(['authority'])
      .action(async ({ session }, groupid, userid) => {
        const groupId = String(groupid === -1 || !groupid ? session.guildId || session.channelId || '0' : groupid)
        const userId = String(userid || session.userId)

				try {
					const trait = await generateTrait.call(this, userId, groupId,session)
					if (Object.keys(trait).length === 0) {
						return '暂无特征信息'
					}
          const responseElements = Object.entries(trait).map(([key, value]) => {
            return h('message', [
              h('author', {}, key),
              h('content', {}, String(value))
            ])
          })
          if(this.config.debugMode){
            return h('figure', { children: responseElements })
          }else{
            ctx.logger.info('figure responseElements:', JSON.stringify(responseElements, null, 2))
            return '特征设置成功'
          }

				} catch (error) {
					this.ctx.logger.error(`生成特征失败: ${error.message}`)
					return '生成特征时发生错误'
				}
			})

    ctx.command('mem.likeRank [maxnumber:number] [groupid:number]')
      .alias('好感排名', '好感排行', '好感排行榜', '好感度排名', '好感度排行', '好感度排行榜')
      .action(async ({ session },maxnumber, groupid) => {
        const groupId = String(groupid ? groupid : session.guildId || session.channelId || '0')

        // 获取当前群组的所有用户记录
        const memoryEntries = await this.ctx.database.get('memory_table', {
          group_id: groupId
        })
        // 过滤并排序用户好感度
        let rankings = await getLikeRankings(memoryEntries)
        rankings = rankings
          .filter(rank => rank.like >= 0)
          .sort((a, b) => b.like - a.like)
          .slice(0, maxnumber >= 5 && maxnumber <= 50 ? maxnumber : 10)

        if (rankings.length === 0) {
          return '当前群组还没有好感度记录~'
        }

        // 获取群成员信息并构建排名消息
        const rankMessages = await Promise.all(rankings.map(async (rank, index) => {
          const member = await session.bot.getGuildMember?.(session.guildId, rank.userId)
          const nickname = member.nick || member?.user?.name || rank.userId

          return `${index + 1}. ${nickname} 好感度：${rank.like}`
        }))

        return ['当前群组好感度排行榜：', ...rankMessages].join('\n')
      })

      ctx.command('mem.like [groupid:number] [userid:number]')
        .alias('好感度')
        .action(async ({ session }, groupid, userid) => {
          const groupId = String(groupid === -1 || !groupid ? session.guildId || session.channelId || '0' : groupid)
          const userId = String(userid || session.userId)

        const memoryEntry = await this.ctx.database.get('memory_table', {
          group_id: groupId,
          user_id: userId
			}).then(entries => entries[0])

			if (!memoryEntry || !memoryEntry.trait) {
				return `<at id="${userId}"/> 我们还不熟呢~`
			}

			// 查找所有包含"好感"的特征键
			const likeKeys = Object.keys(memoryEntry.trait).filter(key => key.includes('好感'))
			if (likeKeys.length === 0) {
				return `<at id="${userId}"/> 我们还不熟呢~`
			}

			// 使用第一个找到的好感值
			const likeKey = likeKeys[0]
			const likeValue = Number(memoryEntry.trait[likeKey])
			if (isNaN(likeValue)) {
				return `<at id="${userId}"/> 好感度为:${likeValue}`
			}

			return `<at id="${userId}"/> 当前好感度：${likeValue}`
		})

    ctx.command('mem.dislikeRank [maxnumber:number] [groupid:number]')
    .alias('差评排名','差评排行榜')
    .action(async ({ session },maxnumber, groupid) => {
      const groupId = String(groupid ? groupid : session.guildId || session.channelId || '0')

      // 获取当前群组的所有用户记录
      const memoryEntries = await this.ctx.database.get('memory_table', {
        group_id: groupId
      })

      let rankings = await getLikeRankings(memoryEntries)

      rankings = rankings
        .filter(rank => rank.like < 0)
        .sort((a, b) => a.like - b.like)
        .slice(0, maxnumber >= 5 && maxnumber <= 50 ? maxnumber : 10)

      if (rankings.length === 0) {
        return '当前群组还没有差评记录~'
      }

      // 获取群成员信息并构建排名消息
      const rankMessages = await Promise.all(rankings.map(async (rank, index) => {
        const member = await session.bot.getGuildMember?.(session.guildId, rank.userId)

        const nickname = member.nick || member?.user?.name || rank.userId

        return `${index + 1}. ${nickname} 好感度：${rank.like}`
      }))

      return ['当前群组差评排行榜：', ...rankMessages].join('\n')
    })

		ctx.command('mem.mem [groupid:number] [userid:number]',{ authority: 2 })
      .userFields(['authority'])
      .action(async ({ session }, groupid, userid) => {
        const groupId = String(groupid === -1 || !groupid ? session.guildId || session.channelId || '0' : groupid)
        const userId = String(userid || session.userId)

				const memoryEntry = await this.ctx.database.get('memory_table', {
					group_id: groupId,
					user_id: userId
				}).then(entries => entries[0])

				if (!memoryEntry) {
					return '暂无记忆信息'
				}

				const responseElements = []

				// 添加特征信息
				if (Object.keys(memoryEntry.trait).length > 0) {
					responseElements.push(h('message', [
						h('author', {}, '特征'),
						h('content', {}, Object.entries(memoryEntry.trait)
							.map(([key, value]) => `${key}: ${value}`)
							.join('\n'))
					]))
				}

				// 添加短期记忆
				if (memoryEntry.memory_st.length > 0) {
					responseElements.push(h('message', [
						h('author', {}, '短期记忆'),
						h('content', {}, memoryEntry.memory_st.join('\n'))
					]))
				}

				// 添加长期记忆
				if (memoryEntry.memory_lt.length > 0) {
					responseElements.push(h('message', [
						h('author', {}, '长期记忆'),
						h('content', {}, memoryEntry.memory_lt.join('\n'))
					]))
				}

				if (responseElements.length === 0) {
					return '暂无记忆信息'
				}

				return h('figure', { children: responseElements })
			})

      //查看历史记录，目前存在问题，用合并的方式显示，所有发送人的昵称都会显示成机器人的，暂时没想出来怎么解决
      ctx.command('mem.history [groupid:number] [userid:number]',{ authority: 2 })
      .userFields(['authority'])
      .action(async ({ session }, groupid, userid) => {
        const groupId = String(groupid === -1 || !groupid ? session.guildId || session.channelId || '0' : groupid)
        const userId = String(userid || session.userId)

				// 获取历史记录
				const memoryEntry = await this.ctx.database.get('memory_table', {
					group_id: groupId,
					user_id: userId
				}).then(entries => entries[0])

				if (!memoryEntry || !memoryEntry.history.length) {
					return '暂无历史记录'
				}

				// 构建消息元素
				const responseElements = memoryEntry.history
          .filter(entry => entry.content && entry.content.trim() !== '')
          .map(entry => {
            const contentElements = [];
            const parts = entry.content.split(/(@\d+)/);

            for (const part of parts) {
              const atMatch = part.match(/@(\d+)/);
              if (atMatch) {
                contentElements.push(h('at', { id: atMatch[1] }));
                contentElements.push(h('text', { content: ' ' }));
              } else if (part.trim()) {
                contentElements.push(h('text', { content: part.trim() }));
                contentElements.push(h('text', { content: ' ' }));
              }
            }

            if (contentElements.length > 0 &&
                contentElements[contentElements.length - 1].attrs?.content === ' ') {
              contentElements.pop();
            }

            return h('message', [
              h('author', { id: entry.sender_id }, entry.sender_name),
              h('content', {}, contentElements)
            ]);
          })
				// 创建figure元素
				const figureContent = h('figure', {
					children: responseElements
				})
        // this.ctx.logger.info('figureContent:',figureContent)

				// 发送消息
				return figureContent
			})
    // 添加备份指令
    ctx.command('mem.backup',{ authority: 2 })
			.userFields(['authority'])
      .action(async () => {
        return this.backupMem()
      })

    // 添加恢复指令
    ctx.command('mem.restore',{ authority: 2 })
			.userFields(['authority'])
      .action(async ({ session }) => {
        try {
          const backupDir = path.join(__dirname, '..', 'backup')
          if (!fs.existsSync(backupDir)) {
            return '没有找到备份文件夹'
          }

          // 获取并排序备份文件
          const files = fs.readdirSync(backupDir)
            .filter(file => file.startsWith('memory_backup_') && file.endsWith('.json'))
            .map(file => ({
              name: file,
              path: path.join(backupDir, file),
              time: fs.statSync(path.join(backupDir, file)).mtime
            }))
            .sort((a, b) => b.time.getTime() - a.time.getTime())
            .slice(0, 5)

          if (files.length === 0) {
            return '没有找到备份文件'
          }

          // 显示备份列表
          const backupList = files.map((file, index) => {
            const date = file.time.toLocaleString()
            return `${index + 1}. ${date} (${file.name})`
          }).join('\n')

          await session.send('请选择要恢复的备份序号:\n' + backupList + '\n输入0取消操作')

          // 等待用户输入
          const chosen = await session.prompt(30000)

          // 如果用户没有输入（超时），则退出恢复流程
          if (chosen === null) {
            return '恢复操作已取消：等待输入超时'
          }

          // 检查用户输入
          const index = parseInt(chosen) - 1
          if (chosen === '0') {
            return '已取消恢复操作'
          }
          if (isNaN(index) || index < 0 || index >= files.length) {
            return '无效的序号，恢复操作已取消'
          }

          // 读取备份文件
          const backupData = JSON.parse(fs.readFileSync(files[index].path, 'utf8'))

          // 清空当前数据库并导入备份数据
          await this.ctx.database.remove('memory_table', {})
          await this.ctx.database.upsert('memory_table', backupData)

          return `已成功恢复备份: ${files[index].name}`
        } catch (error) {
          this.ctx.logger.error(`恢复备份失败: ${error.message}`)
          return '恢复备份失败，请查看日志了解详细信息'
        }
      })

    //  测试指令
    ctx.command('mem.say <content:text>',{ authority: 2 })
			.userFields(['authority'])
      .action(async ({ session }, content) => {
        if (!content) {
          return '请输入要复述的内容。'
        }
        // 设置消息内容
        session.content = content
        session.elements = [h('text', { content }, [content])]
        // 复述用户的内容
        session.send(content)
      })

    // 测试指令
    ctx.command('mem.test',{ authority: 2 })
    .action(async ({ session }, content) => {
      if (!content) {
        return '请输入要复述的内容。'
      }
      // 设置消息内容
      session.content = content
      session.elements = [h('text', { content }, [content])]
      // 复述用户的内容
      session.send(content)
    })

		// 监听消息
		ctx.on('message', async (session: Session) => {
      ctx.logger.info('收到message.content:',session.content)
      if(!config.botMesReport){
        await this.handleMessage(session)
      }else{
        // 检查是否是机器人消息
        if(session.bot.selfId === session.userId){
          await this.handleMessageBot(session)
        }else{
          await this.handleMessage(session)
        }
      }
      // this.ctx.logger.info('message',session)
      await this.autoUpdateTrait(session.userId,session.guildId || session.channelId || '0',session)
		})

    // //监听机器人消息
    // ctx.on('send', async (session: Session) => {
    //   if(!config.botMesReport){
    //     await this.handleMessageBot(session)
    //     this.ctx.logger.info('send',session)
    //   }
    // })
	}

  // 备份记忆表
  private async backupMem() {
    try {
      // 创建backup文件夹
      const backupDir = path.join(__dirname, '..', 'backup')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      // 获取所有记忆表数据
      const allMemoryData = await this.ctx.database.get('memory_table', {})

      // 生成带时间戳的文件名
      const date = new Date()
      const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`
      const backupFile = path.join(backupDir, `memory_backup_${timestamp}.json`)

      // 将数据写入文件
      fs.writeFileSync(backupFile, JSON.stringify(allMemoryData, null, 2))

      return `备份成功：${path.basename(backupFile)}`
    } catch (error) {
      this.ctx.logger.error(`备份失败: ${error.message}`)
      return '备份失败，请查看日志了解详细信息'
    }
  }
  	// 处理oob回传机器人消息
	private async handleMessageBotOob(session: Session, content: string , authID:string) {
    //将消息存在群聊数据中
    const groupChatGroupId = session.guildId || session.channelId
    // 仅在群聊中记录总消息
    if (groupChatGroupId) {
      const groupMessageEntry: MessageEntry = {
        message_id: 're_oob_' + session.messageId, // 添加前缀以区分
        content: this.filterMessageContent(content || session.content),
        sender_id: session.bot.selfId,
        sender_name: '机器人',
        timestamp: new Date(),
        used: false
      }
      if(groupMessageEntry.content === '') return // 如果过滤后内容为空，则不保存

      let groupMemoryEntry = await this.ctx.database.get('memory_table', {
        group_id: groupChatGroupId,
        user_id: '0' // user_id 为 '0' 代表群聊总记录
      }).then(entries => entries[0])

      if (!groupMemoryEntry) {
        groupMemoryEntry = {
          group_id: groupChatGroupId,
          user_id: '0',
          trait: {},
          traitBak: {},
          memory_st: [],
          memory_lt: [],
          history: []
        }
      }
      const maxGroupHistory = Math.min(this.config.maxMessages * 5, groupMemoryEntry.history.length + 1)
      groupMemoryEntry.history = [...groupMemoryEntry.history, groupMessageEntry].slice(-maxGroupHistory)
      await this.ctx.database.upsert('memory_table', [groupMemoryEntry])
      this.ctx.logger.info(`OOB消息已存入群聊 ${groupChatGroupId} 的总记录`)
    }

    // this.ctx.logger.info('处理oob回传机器人消息',session)
    // 获取目标用户ID
    let targetUserId = authID
    let targetGroupId = session.guildId || session.channelId || '0'

    // this.ctx.logger.info('前this.messageQueue.length：',this.messageQueue.length)

      // 构建消息记录
      const messageEntry: MessageEntry = {
        message_id: 're'+session.messageId,
        content: this.filterMessageContent(content||session.content),
        sender_id: session.bot.selfId,
        sender_name: '机器人',
        timestamp: new Date(),
        used: false
      }
      if(messageEntry.content === '') return
      // 获取或创建记忆表
      let memoryEntry = await this.ctx.database.get('memory_table', {
        group_id: targetGroupId,
        user_id: targetUserId
      }).then(entries => entries[0])

      if (!memoryEntry) {
        memoryEntry = {
          group_id: targetGroupId,
          user_id: targetUserId,
          trait: {},
            traitBak: {},
          memory_st: [],
          memory_lt: [],
          history: []
        }
      }

      // 更新历史记录
      const maxHistory = Math.min(this.config.maxMessages, memoryEntry.history.length + 1)
      memoryEntry.history = [...memoryEntry.history, messageEntry].slice(-maxHistory)
      // 保存或更新记忆表
      await this.ctx.database.upsert('memory_table', [memoryEntry])
      // 从消息队列中移除匹配的最早记录
      const matchIndex = this.messageQueue.findIndex(item =>
        item.userId === targetUserId && item.groupId === targetGroupId
      )
      if (matchIndex !== -1) {
        this.messageQueue.splice(matchIndex, 1)
      }
      // this.ctx.logger.info('后this.messageQueue.length：',this.messageQueue.length)

      return
}
	// 处理机器人消息
	private async handleMessageBot(session: Session, content?: string) {
			// 获取目标用户ID
			let targetUserId: string | undefined
			let targetGroupId = '0'

			// 检查是否是引用回复
			if (session.quote?.user?.id) {
				targetUserId = session.quote.user?.id
				targetGroupId = session.guildId || session.channelId || '0'
			}
			// 检查是否是@消息
			else {
				const atElement = session.elements?.find(element => element.type === 'at')
				if (atElement?.attrs?.id) {
					targetUserId = atElement.attrs.id
					targetGroupId = session.guildId || session.channelId || '0'
				}
			}
      // this.ctx.logger.info('this.messageQueue.length：',this.messageQueue.length)

			// 如果找到目标用户，直接存储消息
			if (targetUserId) {
				// 构建消息记录
				const messageEntry: MessageEntry = {
					message_id: session.messageId,
					content: this.filterMessageContent(content||session.content),
					sender_id: session.userId,
					sender_name: session.username,
					timestamp: new Date(),
          used: false
				}
        if(messageEntry.content === '') return
				// 获取或创建记忆表
				let memoryEntry = await this.ctx.database.get('memory_table', {
					group_id: targetGroupId,
					user_id: targetUserId
				}).then(entries => entries[0])

				if (!memoryEntry) {
					memoryEntry = {
						group_id: targetGroupId,
						user_id: targetUserId,
						trait: {},
            traitBak: {},
						memory_st: [],
						memory_lt: [],
						history: []
					}
				}

				// 更新历史记录
				const maxHistory = Math.min(this.config.maxMessages, memoryEntry.history.length + 1)
				memoryEntry.history = [...memoryEntry.history, messageEntry].slice(-maxHistory)
				// 保存或更新记忆表
				await this.ctx.database.upsert('memory_table', [memoryEntry])
			} else if (this.messageQueue.length > 0) {
				// 如果没有找到目标用户，从消息队列中获取最早的用户
				const { userId: queueUserId, groupId: queueGroupId } = this.messageQueue.shift()

				// 构建消息记录
				const messageEntry: MessageEntry = {
					message_id: session.messageId,
					content: this.filterMessageContent(session.content),
					sender_id: session.userId,
					sender_name: session.username,
					timestamp: new Date(),
          used: false
				}
        this.ctx.logger.info('messageEntry：',messageEntry)

				// 获取或创建记忆表
				let memoryEntry = await this.ctx.database.get('memory_table', {
					group_id: queueGroupId,
					user_id: queueUserId
				}).then(entries => entries[0])
        this.ctx.logger.info('group_id：',queueGroupId,'user_id：',queueUserId)

				if (!memoryEntry) {
					memoryEntry = {
						group_id: queueGroupId,
						user_id: queueUserId,
						trait: {},
            traitBak: {},
						memory_st: [],
						memory_lt: [],
						history: []
					}
				}

				// 更新历史记录
				const maxHistory = Math.min(this.config.maxMessages, memoryEntry.history.length + 1)
				memoryEntry.history = [...memoryEntry.history, messageEntry].slice(-maxHistory)

				// 保存或更新记忆表
				await this.ctx.database.upsert('memory_table', [memoryEntry])
			}
			return
  }
	// 处理用户消息
	private async handleMessage(session: Session) {
    //将消息存在群聊数据中
    const groupChatGroupId = session.guildId || session.channelId
    // 仅在群聊中记录总消息
    if (groupChatGroupId) {
      const groupMessageEntry: MessageEntry = {
        message_id: session.messageId,
        content: this.filterMessageContent(session.content),
        sender_id: session.userId,
        sender_name: session.username,
        timestamp: new Date(),
        used: false // 群聊总记录的消息初始状态也为未使用
      }

      let groupMemoryEntry = await this.ctx.database.get('memory_table', {
        group_id: groupChatGroupId,
        user_id: '0' // user_id 为 '0' 代表群聊总记录
      }).then(entries => entries[0])

      if (!groupMemoryEntry) {
        groupMemoryEntry = {
          group_id: groupChatGroupId,
          user_id: '0',
          trait: {},
          traitBak: {},
          memory_st: [],
          memory_lt: [],
          history: []
        }
      }
      const maxGroupHistory = Math.min(this.config.maxMessages * 5, groupMemoryEntry.history.length + 1) // 群聊总记录可以适当多一些
      groupMemoryEntry.history = [...groupMemoryEntry.history, groupMessageEntry].slice(-maxGroupHistory)
      await this.ctx.database.upsert('memory_table', [groupMemoryEntry])
      this.ctx.logger.info(`消息已存入群聊 ${groupChatGroupId} 的总记录`)

      //生成短期记忆总结
      if (groupChatGroupId && !this.generatingSummaryFor.has(groupChatGroupId) && this.config.enableMemSt) {
        const unusedMessagesCount = groupMemoryEntry.history.filter(entry => !entry.used).length
        if (unusedMessagesCount >= this.config.memoryStMessages) {
          this.generatingSummaryFor.add(groupChatGroupId)
          this.ctx.logger.info(`群聊 ${groupChatGroupId} 满足生成总结条件，开始生成...`)
          generateSummary.call(this, groupChatGroupId)
            .then(summary => {
              if (summary) {
                this.ctx.logger.info(`群聊 ${groupChatGroupId} 总结生成成功。`)
                // 在短期记忆生成成功时，调用长期记忆生成
                if(this.config.enableMemLt){
                  generateLongTermMemory.call(this, groupChatGroupId)
                  .then(ltSummary => {
                    if (ltSummary) {
                      this.ctx.logger.info(`群聊 ${groupChatGroupId} 长期记忆生成成功。`)
                    } else {
                      this.ctx.logger.info(`群聊 ${groupChatGroupId} 长期记忆生成未返回内容或失败。`)
                    }
                  })
                  .catch(error => {
                    this.ctx.logger.error(`群聊 ${groupChatGroupId} 长期记忆生成出错: ${error.message}`)
                  })
                }
              } else {
                this.ctx.logger.info(`群聊 ${groupChatGroupId} 总结生成未返回内容或失败。`)
              }
            })
            .catch(error => {
              this.ctx.logger.error(`群聊 ${groupChatGroupId} 总结生成出错: ${error.message}`)
            })
            .finally(() => {
              this.generatingSummaryFor.delete(groupChatGroupId)
              this.ctx.logger.info(`群聊 ${groupChatGroupId} 总结生成流程结束。`)
            })
        } else {
          this.ctx.logger.info(`群聊 ${groupChatGroupId} 未使用消息数量 ${unusedMessagesCount}，未达到生成总结所需的 ${this.config.memoryStMessages} 条。`)
        }
      } else if (this.generatingSummaryFor.has(groupChatGroupId)) {
        this.ctx.logger.info(`群聊 ${groupChatGroupId} 已有总结正在生成中，跳过本次触发。`)
      }
    }

    // 检查是否需要响应消息
		const shouldRespond = (
			// 引用回复
			session.quote?.user?.id === session.bot.selfId ||
			// @机器人
			session.elements?.some(element => element.type === 'at' && element.attrs?.id === session.bot.selfId) ||
			// 私聊消息
			!session.guildId && !session.channelId
		)
    // this.ctx.logger.info('是否需要响应消息：',shouldRespond)
		// 如果不需要响应，直接返回
		if (!shouldRespond) return

		// 将当前用户添加到消息队列
		this.messageQueue.push({
			userId: session.userId,
			groupId: session.guildId || session.channelId || '0'
		})
    this.ctx.logger.info('this.messageQueue.length：',this.messageQueue.length)
		const {userId, username, channelId, guildId } = session
		const groupId = guildId || channelId || '0' // 私聊统一用'0'作为group_id

		// 过滤消息内容
		let content = this.filterMessageContent(session.content)

		// 如果消息内容为空，则不处理
		if (content=='') return

		// 构建消息记录
		const messageEntry: MessageEntry = {
			message_id: session.messageId,
			content,
			sender_id: userId,
			sender_name: username,
			timestamp: new Date(),
      used: false
		}

		// 获取或创建记忆表
		let memoryEntry = await this.ctx.database.get('memory_table', {
			group_id: groupId,
			user_id: userId
		}).then(entries => entries[0])

		if (!memoryEntry) {
			memoryEntry = {
				group_id: groupId,
				user_id: userId,
				trait: {},
        traitBak: {},
				memory_st: [],
				memory_lt: [],
				history: []
			}
		}

		// 更新历史记录
		const maxHistory = Math.min(this.config.maxMessages, memoryEntry.history.length + 1)
		memoryEntry.history = [...memoryEntry.history, messageEntry].slice(-maxHistory)
		// 保存或更新记忆表
		await this.ctx.database.upsert('memory_table', [memoryEntry])
	}
  // 自动更新trait
  private async autoUpdateTrait(user_id,group_id,session) {
    const memoryEntries = await this.ctx.database.get('memory_table', {
      group_id: group_id,
      user_id: user_id
    })
    if (memoryEntries.length > 0) {
      const entry = memoryEntries[0]
      const unusedMessages = entry.history.filter(msg => !msg.used).length
      if (unusedMessages >= this.config.traitMesNumber) {
        this.ctx.logger.info('自动更新trait')
        await generateTrait.call(this, user_id, group_id,session)
      }
    }
  }

  // 清空单人的trait和history
  public async clearTrait(session: Session) {
    const group_id = session.guildId || session.channelId
    const user_id = session.userId || session.author.id
    if(group_id&&user_id){
      let memoryEntry = await this.ctx.database.get('memory_table', {
        group_id: group_id,
        user_id: user_id
      }).then(entries => entries[0])

      if (memoryEntry) {
        memoryEntry.trait = {}
        memoryEntry.history = []
        await this.ctx.database.upsert('memory_table', [memoryEntry])
        this.ctx.logger.info('清空本人当前群聊的trait和history')
      }
    }else{
      this.ctx.logger.info('未获取到群聊或用户id，清空失败')
    }
  }

  // 清空记忆表
  public async clearMem(autoBackup : boolean = true) {
    this.ctx.logger.info('清空记忆表！是否自动备份：',autoBackup)
    if(autoBackup){
      await this.backupMem()
    }
    await this.ctx.database.remove('memory_table', {})
    this.ctx.logger.info('记忆表已清空')
    return '记忆表已清空'
  }

  // 传入机器人消息
  public async setMemBotMes(session: Session, content: string,authID:string) {
    this.ctx.logger.info('传入oob回传的机器人消息:',content)
    if(!this.config.botMesReport){
      await this.handleMessageBotOob(session,content,authID)
    }else{
      this.ctx.logger.info('开了机器人上报无视回传消息')
    }
  }

  // 获取用户记忆信息
  public async getMem(userId: string, groupId: string, session?): Promise<string | Record<string, any>> {
    this.ctx.logger.info('进入getMem函数')
    try {
      const actualGroupId = groupId === '0' ? `private:${userId}` : groupId;
      const [traitMemoryEntry, sharedMemoryEntry] = await Promise.all([
        this.ctx.database.get('memory_table', {
          group_id: actualGroupId,
          user_id: userId
        }).then(entries => entries[0]),
        this.ctx.database.get('memory_table', {
          group_id: actualGroupId,
          user_id: '0' // 群聊总记录
        }).then(entries => entries[0])
      ]);

      const result: Record<string, any> = {};
      const allTraits: Record<string, any> = {};

      // 统一处理trait格式化的函数
      const formatTrait = (trait: Record<string, any>) => {
        return Object.fromEntries(
          Object.entries(trait).map(([key, value]) => [
            key,
            String(value).replace(/用户/g, '对方').replace(/机器人/g, '我')
          ])
        );
      };

      // 处理当前用户的trait
      if (traitMemoryEntry?.trait && Object.keys(traitMemoryEntry.trait).length > 0) {
        const formattedTrait = formatTrait(traitMemoryEntry.trait);
        const currentUserMessage = sharedMemoryEntry?.history?.find(msg => msg.sender_id === userId);
        const currentUserName = currentUserMessage?.sender_name || `用户${userId}`;
        allTraits[`${currentUserName}(${userId})`] = formattedTrait;
        result.trait = formattedTrait; // 保持原有trait字段
      }

      // 处理其他用户的trait (仅当traitCacheNum > 0时)
      if (this.config.traitCacheNum > 0 && sharedMemoryEntry?.history) {
        this.ctx.logger.info('开始处理其他用户的trait')

        const cachedUsers: { id: string; name: string; trait: Record<string, any> }[] = [];
        const addedUserIds = new Set<string>();

        // 倒序遍历群聊历史记录
        for (let i = sharedMemoryEntry.history.length - 1; i >= 0; i--) {
          const message = sharedMemoryEntry.history[i];
          const senderId = message.sender_id;

          // 跳过当前用户和已添加用户
          if (senderId === userId || addedUserIds.has(senderId)) continue;

          // 获取用户trait
          const senderMemoryEntry = await this.ctx.database.get('memory_table', {
            group_id: actualGroupId,
            user_id: senderId
          }).then(entries => entries[0]);

          if (senderMemoryEntry?.trait && Object.keys(senderMemoryEntry.trait).length > 0) {
            cachedUsers.push({
              id: senderId,
              name: message.sender_name,
              trait: senderMemoryEntry.trait,
            });
            addedUserIds.add(senderId);

            // 达到缓存数量上限则停止
            if (cachedUsers.length >= this.config.traitCacheNum) break;
          }
        }

        // 格式化并添加其他用户trait
        cachedUsers.forEach(user => {
          allTraits[`${user.name}(${user.id})`] = formatTrait(user.trait);
        });
      }

      result.traits = allTraits;

      // 处理短期记忆
      if (this.config.enableMemStApi && sharedMemoryEntry?.memory_st?.length > 0) {
        result.memory_st = sharedMemoryEntry.memory_st
          .slice(-this.config.memoryStMesNumUsed)
          .map(memory => memory.replace(/机器人/g, '我'));
      }

      // 处理长期记忆
      if (this.config.enableMemLtApi && sharedMemoryEntry?.memory_lt?.length > 0) {
        result.memory_lt = sharedMemoryEntry.memory_lt.map(memory =>
          memory.replace(/机器人/g, '我')
        );
      }

      //处理知识库
      if (this.config.enableKB && session?.content) {
        if(this.config.knowledgeBooks !== '' || extraKBs.length > 0){
          // 合并配置的知识库和额外知识库
          const kbs = [...this.config.knowledgeBooks, ...extraKBs];
          const resultKbs = [];
          const seenKeywords = new Set();

          for (const kb of kbs) {
            if (!kb.keyword || !kb.keyword.trim()) continue;

            if (typeof kb.keyword === 'string' && kb.keyword.includes(',')) {
              const keywords = kb.keyword.split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);

              // 查找第一个匹配的关键词
              let matchedKeyword = null;
              for (const subKeyword of keywords) {
                const lowerKey = subKeyword.toLowerCase();
                if (session.content.toLowerCase().includes(lowerKey) && !seenKeywords.has(lowerKey)) {
                  matchedKeyword = subKeyword;
                  seenKeywords.add(lowerKey);
                  break; // 找到第一个匹配后立即跳出
                }
              }

              if (matchedKeyword) {
                resultKbs.push({ [matchedKeyword]: kb.content });
                continue; // 跳过后续处理
              }
            } else {
              if (session.content.toLowerCase().includes(kb.keyword.toLowerCase()) && !seenKeywords.has(kb.keyword.toLowerCase())) {
                resultKbs.push({ [kb.keyword]: kb.content });
                seenKeywords.add(kb.keyword.toLowerCase());
              }
            }
          }
          if (resultKbs.length > 0) {
            result.kbs = resultKbs;
          }
        }else{
          this.ctx.logger.info('开启了知识库，但内容为空，跳过处理')
        }
      }

      if (Object.keys(result).length === 0) {
        this.ctx.logger.info(`用户 ${userId} 在群组 ${actualGroupId} 中没有相关记忆`);
        return '';
      }
      //this.ctx.logger.info(`用户 ${userId} 在群组 ${actualGroupId} 中获取到的记忆信息：`, result);
      return result;
    } catch (error) {
      this.ctx.logger.error(`获取记忆信息失败: ${error.message}`);
      return '';
    }
  }
}

  // 调用OpenAI API的工具函数
async function callOpenAI(messages: Array<{ role: string, content: string }>, maxRetries = 3): Promise<any> {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const url = new URL('/v1/chat/completions', this.config.apiEndpoint);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.7
        }),
        signal: AbortSignal.timeout(30000) // 30秒超时
      });

      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      retries++;
      if (error.name === 'TimeoutError') {
        this.ctx.logger.warn('OpenAI API请求超时');
      } else {
        this.ctx.logger.warn(`OpenAI API调用失败: ${error.message}`);
      }

      if (retries === maxRetries) {
        throw new Error(`OpenAI API调用失败，已重试${maxRetries}次: ${error.message}`);
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * retries));
    }
  }
}

//生成长期记忆
async function generateLongTermMemory(groupId: string): Promise<string> {
  try {
    // 获取群聊的记忆条目，user_id 为 '0' 代表群聊的整体记忆
    const memoryEntry = await this.ctx.database.get('memory_table', {
      group_id: groupId,
      user_id: '0'
    }).then(entries => entries[0])

    if (!memoryEntry) {
      this.ctx.logger.info(`群聊 ${groupId} 尚无记忆条目，无法生成长期记忆`)
      return ''
    }

    // 提取 history 中 used 为 true 的记录
    const usedHistory = memoryEntry.history.filter(entry => entry.used)

    if (usedHistory.length === 0) {
      this.ctx.logger.info(`群聊 ${groupId} 没有已使用的短期记忆相关历史记录，无法生成长期记忆`)
      return ''
    }

    // 从最早的一条开始取 memoryLtMessages 条
    const historyForLt = usedHistory.slice(0, this.config.memoryLtMessages)

    if (historyForLt.length === 0) {
      this.ctx.logger.info(`群聊 ${groupId} 没有足够已使用的历史记录生成长期记忆`)
      return ''
    }

    // 格式化消息
    const formattedHistory = historyForLt.map(entry => {
      return `${entry.sender_name}: ${entry.content}`
    }).join('\n')

    let systemContent = this.config.memoryLtPrompt
    if(this.config.botPrompt!==''){
      systemContent = systemContent + '\n以下是该机器人的人设，请代入此人设的视角进行分析：<机器人人设>' + this.config.botPrompt + '</机器人人设>'
    }
    let userContent = `这是相关的聊天记录：\n${formattedHistory}`

    if (memoryEntry.memory_lt && memoryEntry.memory_lt.length > 0) {
      userContent = `这是旧的长期记忆：\n${memoryEntry.memory_lt.join('\n')}\n\n${userContent}`
    }

    const messages = [
      {
        role: 'system',
        content: systemContent
      },
      {
        role: 'user',
        content: userContent
      }
    ]

    //this.ctx.logger.info(`为群聊 ${groupId} 生成长期记忆，输入信息:`, messages)

    // 调用 OpenAI API 生成长期记忆
    let newLongTermMemory = await callOpenAI.call(this, messages)

    if (!newLongTermMemory || newLongTermMemory.trim() === '') {
      this.ctx.logger.warn(`群聊 ${groupId} 生成的长期记忆为空`)
      return ''
    }

    // 更新长期记忆，只保留最新的一个
    const updatedMemoryLt = [newLongTermMemory]

    // 删除已用于生成长期记忆的 history 记录
    const historyForLtIds = new Set(historyForLt.map(entry => entry.message_id))
    const updatedHistory = memoryEntry.history.filter(entry => !historyForLtIds.has(entry.message_id))

    // 更新数据库
    await this.ctx.database.upsert('memory_table', [{
      ...memoryEntry,
      memory_lt: updatedMemoryLt,
      history: updatedHistory
    }])

    this.ctx.logger.info(`群聊 ${groupId} 的新长期记忆已生成并保存: ${newLongTermMemory}`)
    return newLongTermMemory

  } catch (error) {
    this.ctx.logger.error(`为群聊 ${groupId} 生成长期记忆失败: ${error.message}`)
    return ''
  }
}

//生成群聊短期记录总结的工具函数
async function generateSummary(groupId: string): Promise<string> {
  try {
    // 获取群聊的记忆条目，user_id 为 '0' 代表群聊的整体记忆
    const memoryEntry = await this.ctx.database.get('memory_table', {
      group_id: groupId,
      user_id: '0'
    }).then(entries => entries[0])

    if (!memoryEntry) {
      this.ctx.logger.info(`群聊 ${groupId} 尚无记忆条目`)
      return ''
    }

    // 提取最近的 memoryStMessages 条未使用过的 history 记录
    const recentHistory = memoryEntry.history
      .filter(entry => !entry.used)
      .slice(-this.config.memoryStMessages)

    // 提取最近的memoryStMesNumUsed条 memory_st
    const recentMemorySt = memoryEntry.memory_st.slice(-this.config.memoryStMesNumUsed)

    if (recentHistory.length === 0 && recentMemorySt.length === 0) {
      this.ctx.logger.info(`群聊 ${groupId} 没有足够信息生成总结`)
      return ''
    }

    // 格式化消息
    const formattedHistory = recentHistory.map(entry => {
      return `${entry.sender_name}: ${entry.content}`
    }).join('\n')

    let systemContent = this.config.memoryStPrompt
    if(this.config.botPrompt!==''){
      systemContent = systemContent + '\n以下是该机器人的人设，请代入此人设的视角进行分析：<机器人人设>' + this.config.botPrompt + '</机器人人设>'
    }
    let userContent = `这是最近的聊天记录：\n${formattedHistory}\n\n请根据以上信息，生成新的聊天记录总结。`

    if (recentMemorySt.length > 0) {
      userContent = `这是之前的几条总结：\n${recentMemorySt.join('\n')}\n\n${userContent}`
    }

    const messages = [
      {
        role: 'system',
        content: systemContent
      },
      {
        role: 'user',
        content: userContent
      }
    ]

    //this.ctx.logger.info(`为群聊 ${groupId} 生成总结，输入信息:`, messages)

    // 调用 OpenAI API 生成总结
    let summary = await callOpenAI.call(this, messages)

    if (!summary || summary.trim() === '') {
      this.ctx.logger.warn(`群聊 ${groupId} 生成的总结为空`)
      return ''
    }

    // 在生成的总结前添加聊天记录的时间区间
    if (recentHistory.length > 0) {
      const startTime = new Date(recentHistory[0].timestamp).toLocaleString()
      const endTime = new Date(recentHistory[recentHistory.length - 1].timestamp).toLocaleString()
      summary = `[${startTime} ~ ${endTime}] ${summary}`
    }

    // 将新生成的总结添加到 memory_st
    const updatedMemorySt = [...memoryEntry.memory_st, summary]
    if (updatedMemorySt.length > this.config.memoryStMesNumMax) {
      updatedMemorySt.splice(0, updatedMemorySt.length - this.config.memoryStMesNumMax)
    }

    // 标记已使用的 history 记录
    const usedHistoryMessageIds = new Set(recentHistory.map(entry => entry.message_id))
    const updatedHistory = memoryEntry.history.map(entry => {
      if (usedHistoryMessageIds.has(entry.message_id)) {
        return { ...entry, used: true }
      }
      return entry
    })

    // 更新数据库
    await this.ctx.database.upsert('memory_table', [{
      ...memoryEntry,
      memory_st: updatedMemorySt,
      history: updatedHistory
    }])

    this.ctx.logger.info(`群聊 ${groupId} 的新总结已生成并保存: ${summary}`)
    return summary

  } catch (error) {
    this.ctx.logger.error(`为群聊 ${groupId} 生成总结失败: ${error.message}`)
    return ''
  }
}

// 生成用户特征的工具函数
async function generateTrait(userId: string, groupId: string,session:Session): Promise<Record<string, string>> {
  try {
    // 获取记忆表
    const memoryEntry = await this.ctx.database.get('memory_table', {
      group_id: groupId,
      user_id: userId
    }).then(entries => entries[0])

    if (!memoryEntry || !memoryEntry.history.length) {
      return {}
    }

    // 格式化最近的历史消息
    const recentHistory = memoryEntry.history
      .slice(-this.config.traitMesNumber)
      .filter(entry => !entry.used)

    if (recentHistory.length <= 2) {
      this.ctx.logger.info('未使用的消息数量不足，取消特征更新')
      return memoryEntry.trait || {}
    }

    const formattedHistory = recentHistory.map(entry => {
      const tempContent = entry.content.replace(/@\d+\s*/g, '')
      return `${entry.sender_name}(${entry.sender_id}): ${tempContent}`
    }).join('\n')

    // 为每个特征项生成内容
    let trait: Record<string, string> = {}
    let roleContent = Object.keys(memoryEntry.trait).length > 0 ?
    '你是一个记忆分析专家，你的任务是根据用户和机器人的聊天记录分析用户特征。当前已有特征信息，请基于现有特征进行分析。如果没有充分的聊天记录依据，请保持原有特征不变。请按照特征模板进行分析，并以JSON格式返回结果，不需要解释理由。' :
    '你是一个记忆分析专家，你的任务是根据用户和机器人的聊天记录分析用户特征。请按照提供的特征模板进行分析，并以JSON格式返回结果，不需要解释理由。'
    if(this.config.botPrompt!==''){
      roleContent = roleContent + '\n以下是该机器人的人设，请代入此人设的视角进行分析：<机器人人设>' + this.config.botPrompt + '</机器人人设>'
    }
    const messages = [
      { role: 'system', content: roleContent },
      { role: 'user', content: `聊天记录（其中用户的id是${userId}，机器人的id是${session.bot.selfId}，你要分析的是用户的特征，请注意分辨）：
${formattedHistory}
${Object.keys(memoryEntry.trait).length > 0 ? `当前特征：
${JSON.stringify(memoryEntry.trait, null, 2)}
` : ''}特征模板：
${JSON.stringify(this.config.traitTemplate, null, 2)}` }
    ]

    this.ctx.logger.info('记忆分析：',messages)

    try {
      const response = await callOpenAI.call(this, messages)
      // 预处理响应，移除可能存在的Markdown代码块
      const cleanResponse = response.replace(/^```json\s*|```\s*$/g, '').trim()
      const parsedTrait = JSON.parse(cleanResponse)

      // 验证返回的特征是否完整
      if (!parsedTrait || Object.keys(parsedTrait).length === 0) {
        this.ctx.logger.warn('API返回的特征为空，尝试使用现有特征')
        if (Object.keys(memoryEntry.trait).length > 0) {
          this.ctx.logger.info('使用当前trait数据')
          return memoryEntry.trait
        } else if (memoryEntry.traitBak && Object.keys(memoryEntry.traitBak).length > 0) {
          this.ctx.logger.info('当前trait为空，从traitBak恢复trait数据')
          trait = { ...memoryEntry.traitBak }
        } else {
          trait = {}
        }
      } else {
        trait = parsedTrait
      }

      // 标记已使用的消息
      const updatedHistory = memoryEntry.history.map((entry, index) => {
        if (index >= memoryEntry.history.length - this.config.traitMesNumber) {
          return { ...entry, used: true }
        }
        return entry
      })
      this.ctx.logger.info('traitBak：',{ ...memoryEntry.traitBak })
      this.ctx.logger.info('trait：',{ ...memoryEntry.trait })
      // 备份当前trait到traitBak
      const traitBak = { ...memoryEntry.trait }

      // 更新记忆表，保留其他字段不变
      await this.ctx.database.upsert('memory_table', [{
        ...memoryEntry,
        trait,
        traitBak,
        history: updatedHistory
      }])

      this.ctx.logger.info('新特征结果：',trait)

    } catch (error) {
      this.ctx.logger.warn(`生成特征失败: ${error.message}`)
      // 发生错误时保持原有特征
      trait = memoryEntry.trait || {}
    }

    return trait
  } catch (error) {
    this.ctx.logger.error(`生成用户特征失败: ${error.message}`)
    return {}
  }
}
  // 获取群聊好感度排名数据
async function getLikeRankings(memoryEntries) {
  // 获取当前群组的所有用户记录
  return memoryEntries
        .filter(entry => {
          // 检查是否有trait对象
          if (!entry.trait) return false

          // 查找所有包含"好感"的特征键
          const likeKeys = Object.keys(entry.trait).filter(key => key.includes('好感'))
          if (likeKeys.length === 0) return false

          // 使用第一个找到的好感值
          const likeValue = Number(entry.trait[likeKeys[0]])
          return !isNaN(likeValue)
        })
        .map(entry => {
          // 获取第一个包含"好感"的特征值
          const likeKey = Object.keys(entry.trait).find(key => key.includes('好感'))
          return {
            userId: entry.user_id,
            like: Number(entry.trait[likeKey])
          }
        })
}


// 从文件中提取知识库
async function extractKBsFromFile(config,ctx): Promise<Array<{ keyword: string, content: string }>> {
  if(!config.enableExtraKB){
    return []
  }
  ctx.logger.info(`开始处理额外知识库`)
  const kbs = []
  const kbPath = config.KBExtraPath
  if (!kbPath || !fs.existsSync(kbPath)) {
    ctx.logger.error(`未找到知识库文件路径: ${kbPath}`)
    return kbs
  }
  try {
    // 遍历目录获取文件列表
    const files = fs.readdirSync(kbPath)
      .filter(f => {
        // 检查文件扩展名
        const isValidExt = f.endsWith('.json') || f.endsWith('.txt')

        // 如果配置了指定文件名，则进一步过滤
        if (config.KBExtraFileName && config.KBExtraFileName.length > 0) {
          const filename = f.replace(/\.[^/.]+$/, "") // 去除扩展名
          return isValidExt && config.KBExtraFileName.some(entry => entry.filename === filename)
        }

        return isValidExt
      })
      .map(f => path.join(kbPath, f))
    if(files.length === 0){
      ctx.logger.error(`配置的目录下未找到符合要求的json或txt文件`)
      return kbs
    }
    // 处理每个文件
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const data = JSON.parse(content)
        for (const [keyword, value] of Object.entries(data)) {
          kbs.push({ keyword, content: String(value) })
        }
      } catch (error) {
        ctx.logger.error(`处理文件 ${file} 时出错: ${error.message}`)
      }
    }
    ctx.logger.info(`额外知识库处理完成，共从${files.length}个文件中获得${kbs.length}条数据`)
    return kbs
  }
  catch (error) {
    ctx.logger.error(`提取知识库失败: ${error.message}`)
    return kbs
  }
}

// 设置用户特征的工具函数，指令用
async function handleSetTrait(this: MemoryTableService, session: Session, trait: string, groupid?: number, userid?: number) {
  const groupId = String(groupid === undefined ? session.guildId || session.channelId || '0' : groupid)
  const userId = String(userid === undefined ? session.userId || session.author.id: userid)

  try {
    // 尝试解析为JSON格式
    let traitObject;
    try {
      traitObject = JSON.parse(trait);
    } catch (jsonError) {
      // 如果JSON解析失败，尝试按原格式解析
      const traitLines = trait.split('\n')
      traitObject = {}
      for (const line of traitLines) {
        const [key, value] = line.split(': ')
        if (key && value) {
          traitObject[key.trim()] = value.trim()
        }
      }
    }

    // 获取或创建记忆表
    let memoryEntry = await this.ctx.database.get('memory_table', {
      group_id: groupId,
      user_id: userId
    }).then(entries => entries[0])

    if (!memoryEntry) {
      memoryEntry = {
        group_id: groupId,
        user_id: userId,
        trait: {},
        traitBak: {},
        memory_st: [],
        memory_lt: [],
        history: []
      }
    }

    // 更新特征
    memoryEntry.trait = traitObject

    // 保存到数据库
    await this.ctx.database.upsert('memory_table', [memoryEntry])

    const responseElements = Object.entries(traitObject).map(([key, value]) => {
      return h('message', [
        h('author', {}, key),
        h('content', {}, String(value))
      ])
    })

    if(this.config.debugMode){
      return h('figure', { children: responseElements })
    }else{
      this.ctx.logger.info('figure', { children: responseElements })
      return '特征设置成功'
    }

  } catch (error) {
    this.ctx.logger.error(`设置特征失败: ${error.message}`)
    return '设置特征失败，请检查输入格式是否正确'
  }
}

// 导出插件
export async function apply(ctx: Context, config: Config) {
  // 直接创建服务实例
  ctx.plugin(MemoryTableService, config)
  extraKBs = await extractKBsFromFile(config,ctx)
}
