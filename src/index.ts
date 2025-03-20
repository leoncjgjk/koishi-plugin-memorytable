import { Context, Schema, Session, Service, h } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'

// 扩展Koishi事件系统以支持机器人消息事件
export const name = 'memorytable'

export interface Config {
  maxMessages?: number
  apiEndpoint?: string
  apiKey?: string
  model?: string
  memoryLtWordsLimit?: number
  traitMesNumberFT?: number
  traitMesNumber?: number
  traitTemplate?: Record<string, string>
  botMesReport?: boolean
  debugMode?: boolean
}

export const Config = Schema.object({
  maxMessages: Schema.number()
    .default(20)
    .description('每个聊天对象保存的聊天记录(单群）'),
  apiEndpoint: Schema.string()
    .default('https://api.openai.com/v1/chat/completions')
    .description('OpenAI兼容API的端点URL'),
  apiKey: Schema.string()
    .role('secret')
    .description('OpenAI API密钥'),
  model: Schema.string()
    .default('gpt-3.5-turbo')
    .description('使用的模型名称'),
  memoryLtWordsLimit: Schema.number()
    .default(300)
    .description('长期记忆字数上限'),
  traitMesNumberFT: Schema.number()
    .default(6)
    .description('更新特征读取的消息数量(第一次创建时)'),
  traitMesNumber: Schema.number()
    .default(10)
    .description('更新特征读取的消息数量（后续更新）'),
  traitTemplate: Schema.dict(Schema.string())
    .description('特征模板，键为特征项，值为提示词')
    .default({
      '性别': '只允许填：未知/男/女',
      '称呼': '机器人应该如何称呼用户？',
      '印象': '总结一下机器人对用户的印象和看法,用形容词，不超过20个字',
      '好感度': '用-100到100的数字表示机器人对用户的好感度',
      '事件':'总结一下机器人和用户之间发生过的印象深刻的事情，不超过50个字'
    }),
  botMesReport: Schema.boolean()
   .default(false)
   .description('是否已开启机器人聊天上报（不知道的开了也没用）'),
  debugMode: Schema.boolean()
   .default(false)
   .description('是否开启调试模式')
})

// 定义数据库表结构
declare module 'koishi' {
  interface Tables {
    memory_table: MemoryTableEntry
  }
  interface Context {
    memorytable: MemoryTableService
  }
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
	user_id: string
	trait: Record<string, any> //对方特征
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
		return content
			.replace(/<img[^>]*\/>/g, '')
			.replace(/<json[^>]*\/>/g, '')
			.replace(/<audio[^>]*\/>/g, '')
			.replace(/<file[^>]*\/>/g, '')
			.replace(/<forward[^>]*\/>/g, '')
			.replace(/<mface[^>]*\/>/g, '')
			.replace(/<face[^>]*>.*?<\/face>/g, '')
			.replace(/<at[^>]*id="([^"]+)".*?\/>/g, '@$1 ')
			.trim()
	}

	static inject = ['database']

  private messageQueue: Array<{ userId: string, groupId: string }> = []

  constructor(ctx: Context, config: Config & { maxMessages: number }) {
    // 调用 Service 构造函数，注册服务名称
    super(ctx, 'memorytable', true)
    this.config = config
    // 初始化数据库
		ctx.database.extend('memory_table', {
			group_id: 'string',
			user_id: 'string',
			trait: 'json',
			memory_st: 'list',
			memory_lt: 'list',
			history: 'json'
		}, {
			primary: ['group_id', 'user_id'],
      autoInc: false,
		})

		// 注册指令
		ctx.command('mem.setTrait <trait:string> [groupid:number] [userid:number]',{ authority: 2 })
      .userFields(['authority'])
      .action(async ({ session },trait, groupid, userid) => {
        const groupId = String(groupid === -1 || !groupid ? session.guildId || session.channelId || '0' : groupid)
        const userId = String(userid || session.userId)

        try {
          // 解析trait字符串为对象
          const traitLines = trait.split('\n')
          const traitObject = {}

          for (const line of traitLines) {
            const [key, value] = line.split(': ')
            if (key && value) {
              traitObject[key.trim()] = value.trim()
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
            ctx.logger.info('figure', { children: responseElements })
            return '特征设置成功'
          }

        } catch (error) {
          this.ctx.logger.error(`设置特征失败: ${error.message}`)
          return '设置特征失败，请检查输入格式是否正确'
        }
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

    ctx.command('mem.likeRank [groupid:number]')
      .alias('好感排名')
      .action(async ({ session }, groupid) => {
        const groupId = String(groupid ? groupid : session.guildId || session.channelId || '0')

        // 获取当前群组的所有用户记录
        const memoryEntries = await this.ctx.database.get('memory_table', {
          group_id: groupId
        })

        // 过滤并排序用户好感度
        const rankings = memoryEntries
          .filter(entry => entry.trait && entry.trait['好感度'] && !isNaN(Number(entry.trait['好感度'])))
          .map(entry => ({
            userId: entry.user_id,
            like: Number(entry.trait['好感度'])
          }))
          .sort((a, b) => b.like - a.like)
          .slice(0, 10)

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

			if (!memoryEntry || !memoryEntry.trait || !memoryEntry.trait['好感度']) {
				return `<at id="${userId}"/> 我们还不熟呢~`
			}
			return `<at id="${userId}"/> 当前好感度：${memoryEntry.trait['好感度']}`
		})

    ctx.command('mem.dislikeRank [groupid:number]')
    .alias('差评排名')
    .action(async ({ session }, groupid) => {
      const groupId = String(groupid ? groupid : session.guildId || session.channelId || '0')

      // 获取当前群组的所有用户记录
      const memoryEntries = await this.ctx.database.get('memory_table', {
        group_id: groupId
      })

      // 过滤负好感度用户并按照好感度从低到高排序
      const rankings = memoryEntries
        .filter(entry => entry.trait && entry.trait['好感度'] && !isNaN(Number(entry.trait['好感度'])) && Number(entry.trait['好感度']) < 0)
        .map(entry => ({
          userId: entry.user_id,
          like: Number(entry.trait['好感度'])
        }))
        .sort((a, b) => a.like - b.like)
        .slice(0, 10)

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

    // 添加新的指令 'mem say'
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

		// 监听消息
		ctx.on('message', async (session: Session) => {
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
  	// 处理oob回传机器人消息
	private async handleMessageBotOob(session: Session, content: string , authID:string) {
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
		if (!content) return

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

  // 传入机器人消息
  public async setMemBotMes(session: Session, content: string,authID:string) {
    if(!this.config.botMesReport){
      await this.handleMessageBotOob(session,content,authID)
    }else{
      this.ctx.logger.info('开了机器人上报无视回传消息')
    }
  }

  // 获取用户记忆信息
  public async getMem(userId: string, groupId: string): Promise<string | Record<string, any>> {
    try {
      const actualGroupId = groupId === '0' ? `private:${userId}` : groupId;
      const memoryEntry = await this.ctx.database.get('memory_table', {
        group_id: actualGroupId,
        user_id: userId
      }).then(entries => entries[0])

      if (!memoryEntry) {
        this.ctx.logger.info(`还没有记忆`)
        return ''
      }

      const result: Record<string, any> = {}
      // 添加非空的特征信息
      if (Object.keys(memoryEntry.trait).length > 0) {
        // 对特征中的文本进行替换
        result.trait = Object.fromEntries(
          Object.entries(memoryEntry.trait).map(([key, value]) => [
            key,
            String(value).replace(/用户/g, '对方').replace(/机器人/g, '我')
          ])
        )
      }

      // 添加非空的短期记忆
      if (memoryEntry.memory_st.length > 0) {
        result.memory_st = memoryEntry.memory_st.map(memory =>
          memory.replace(/用户/g, '对方').replace(/机器人/g, '我')
        )
      }

      // 添加非空的长期记忆
      if (memoryEntry.memory_lt.length > 0) {
        result.memory_lt = memoryEntry.memory_lt.map(memory =>
          memory.replace(/用户/g, '对方').replace(/机器人/g, '我')
        )
      }

      return Object.keys(result).length > 0 ? result : ''
    } catch (error) {
      this.ctx.logger.error(`获取记忆信息失败: ${error.message}`)
      return ''
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
    // this.ctx.logger.info('formattedHistory：',formattedHistory)
    // 为每个特征项生成内容
    const trait: Record<string, string> = {}
    const messages = [
      { role: 'system', content: Object.keys(memoryEntry.trait).length > 0 ?
        '你是一个记忆分析专家，你的任务是根据用户和机器人的聊天记录分析用户特征。当前已有特征信息，请基于现有特征进行分析。如果没有充分的聊天记录依据，请保持原有特征不变。请按照特征模板进行分析，并以JSON格式返回结果，不需要解释理由。' :
        '你是一个记忆分析专家，你的任务是根据用户和机器人的聊天记录分析用户特征。请按照提供的特征模板进行分析，并以JSON格式返回结果，不需要解释理由。' },
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
      Object.assign(trait, parsedTrait)
     // 标记已使用的消息
    const updatedHistory = memoryEntry.history.map((entry, index) => {
      if (index >= memoryEntry.history.length - this.config.traitMesNumber) {
        return { ...entry, used: true }
      }
      return entry
    })

    // 更新记忆表
    await this.ctx.database.set('memory_table', {
      group_id: groupId,
      user_id: userId
    }, {
      trait,
      history: updatedHistory
    })
    this.ctx.logger.info('新特征结果：',trait)

    } catch (error) {
      this.ctx.logger.warn(`生成特征失败: ${error.message}`)
      for (const key of Object.keys(this.config.traitTemplate)) {
        trait[key] = '未知'
      }
    }

    return trait
  } catch (error) {
    this.ctx.logger.error(`生成用户特征失败: ${error.message}`)
    return {}
  }
}

// 导出插件
export function apply(ctx: Context, config: Config) {
  // 直接创建服务实例
  ctx.plugin(MemoryTableService, config)
}
