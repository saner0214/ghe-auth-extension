const vscode = require('vscode');

/** VS Code 配置写入后的等待时间（毫秒），确保文件落盘 */
const CONFIG_WRITE_DELAY = 200;

/**
 * 等待指定毫秒数
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 以嵌套对象方式更新 github.copilot.advanced 配置
 *
 * 核心策略：
 *   不使用 getConfiguration('github.copilot.advanced').update('authProvider', value)
 *   而是读取整个对象 → 合并 → 整体写回
 *
 * 原因：
 *   VS Code 的 getConfiguration(section).update(key) 会生成扁平格式:
 *     "github.copilot.advanced.authProvider": "github-enterprise"
 *
 *   如果 settings.json 里同时存在嵌套格式:
 *     "github.copilot.advanced": {}
 *
 *   嵌套格式优先级更高，空对象会把扁平值静默吞掉。
 *
 *   通过整体写入嵌套对象，生成:
 *     "github.copilot.advanced": { "authProvider": "github-enterprise" }
 *
 *   从源头消除冲突。
 *
 * @param {string} key - 子键，如 'authProvider'
 * @param {any} value - 值
 */
async function updateCopilotAdvanced(key, value) {
	try {
		const rootConfig = vscode.workspace.getConfiguration();

		// 读取当前完整的 github.copilot.advanced 对象，保留其他扩展/用户设置的子键
		const current = rootConfig.get('github.copilot.advanced');

		// 类型防护：如果当前值不是对象（用户手误写了字符串等），保留原值不覆盖
		let base = {};
		if (current && typeof current === 'object' && !Array.isArray(current)) {
			base = { ...current };
		} else if (current !== undefined && current !== null) {
			// 非对象、非空 → 异常值，记录警告但不丢弃
			console.warn(`[Config] github.copilot.advanced 当前值类型异常: ${typeof current}, 值: ${JSON.stringify(current)}`);
			console.warn('[Config] 跳过合并，仅追加目标 key');
		}

		const merged = { ...base, [key]: value };

		// 整体写回嵌套对象
		// VS Code 写入 "github.copilot.advanced": { "authProvider": "..." } 时
		// 会自动清理同命名空间下的扁平 key（如 "github.copilot.advanced.authProvider"）
		await rootConfig.update('github.copilot.advanced', merged, vscode.ConfigurationTarget.Global);
		await sleep(CONFIG_WRITE_DELAY);

		// 验证
		const verify = vscode.workspace.getConfiguration().get('github.copilot.advanced');
		const saved = verify ? verify[key] : undefined;
		console.log(`[Config] github.copilot.advanced.${key} = ${JSON.stringify(saved)} (expected: ${JSON.stringify(value)})`);

		return saved === value;
	} catch (error) {
		console.error(`[Config] Error updating github.copilot.advanced.${key}:`, error);
		throw error;
	}
}

/**
 * 安全更新普通配置项（非 copilot.advanced）
 * @param {string} section - 配置节（如 'github-enterprise'）
 * @param {string} key - 配置键（如 'uri'）
 * @param {any} value - 配置值
 */
async function safeUpdateConfig(section, key, value) {
	try {
		const config = vscode.workspace.getConfiguration(section);
		await config.update(key, value, vscode.ConfigurationTarget.Global);
		await sleep(CONFIG_WRITE_DELAY);

		// 验证
		const newConfig = vscode.workspace.getConfiguration(section);
		const saved = newConfig.get(key);
		const expected = JSON.stringify(value);
		const actual = JSON.stringify(saved);
		console.log(`[Config] ${section}.${key} = ${actual} (expected: ${expected})`);

		// 使用 JSON 序列化比较，避免对象引用不等的误判
		return actual === expected;
	} catch (error) {
		console.error(`[Config] Error updating ${section}.${key}:`, error);
		throw error;
	}
}

/**
 * 读取配置
 */
function getConfigValue(section, key) {
	const config = vscode.workspace.getConfiguration(section);
	return config.get(key);
}


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('[GHE Auth Helper] Extension activated');

	// ===== 激活时仅检测，不自动修改任何配置 =====
	const currentUri = getConfigValue('github-enterprise', 'uri');
	const currentAuth = getConfigValue('github.copilot.advanced', 'authProvider');

	if (currentUri && currentAuth) {
		// ✅✅ 配置完整
		console.log('[Activate] Config OK');
	} else {
		// ❌ 任何一个缺失 → 提示 Setup
		const missing = [];
		if (!currentUri) missing.push('Enterprise URI');
		if (!currentAuth) missing.push('Auth Provider');
		console.log(`[Activate] Missing config: ${missing.join(', ')}`);

		vscode.window.showInformationMessage(
			`👋 GitHub Enterprise Copilot 配置不完整（缺少 ${missing.join('、')}），是否立即设置？`,
			'运行 Setup', '稍后'
		).then(choice => {
			if (choice === '运行 Setup') {
				vscode.commands.executeCommand('gheAuth.setup');
			}
		});
	}

	// ================== 完整配置向导（智能补全） ==================
	const setupCommand = vscode.commands.registerCommand('gheAuth.setup', async () => {
		try {
			// 读取已有配置，用于预填充
			const existingUri = getConfigValue('github-enterprise', 'uri');

			// 步骤 1：输入 GitHub Enterprise URL（已有则预填充）
			const gheUri = await vscode.window.showInputBox({
				title: existingUri ? '确认 GitHub Enterprise Server URL' : '输入 GitHub Enterprise Server URL',
				prompt: existingUri ? '当前已配置的地址如下，可直接确认或修改' : '请输入你的 GitHub Enterprise Server 地址',
				value: existingUri || '',
				placeHolder: 'https://github.mycompany.com',
				ignoreFocusLost: true,
				validateInput: (value) => {
					if (!value) return '请输入 URL';
					if (!value.startsWith('https://')) return 'URL 必须以 https:// 开头';
					try {
						new URL(value);
						return null;
					} catch {
						return '请输入有效的 URL';
					}
				}
			});

			if (!gheUri) {
				vscode.window.showWarningMessage('已取消配置');
				return;
			}

			// 步骤 2：一次性保存 URI + authProvider（覆盖写入解决所有格式冲突）
			const uriSaved = await safeUpdateConfig('github-enterprise', 'uri', gheUri);
			const authSaved = await updateCopilotAdvanced('authProvider', 'github-enterprise');

			if (!uriSaved || !authSaved) {
				const failed = [];
				if (!uriSaved) failed.push('github-enterprise.uri');
				if (!authSaved) failed.push('github.copilot.advanced.authProvider');
				vscode.window.showErrorMessage(`❌ 保存配置失败：${failed.join(', ')}`);
				return;
			}

			// 步骤 3：检查是否已有认证会话
			let session = null;
			try {
				session = await vscode.authentication.getSession('github-enterprise', ['user:email'], {
					createIfNone: false,
					silent: true
				});
			} catch {
				// 静默检查失败，忽略
			}

			if (session) {
				// 已认证 → 直接跳到完成
				vscode.window.showInformationMessage(`✅ 配置完成！已登录用户: ${session.account.label}`);
			} else {
				// 未认证 → 引导认证
				const authChoice = await vscode.window.showInformationMessage(
					'✅ 配置已保存，现在进行 GitHub Enterprise 认证',
					'开始认证', '稍后认证'
				);

				if (authChoice === '开始认证') {
					await vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: '正在连接 GitHub Enterprise...',
						cancellable: false
					}, async () => {
						session = await vscode.authentication.getSession('github-enterprise', ['user:email'], {
							createIfNone: true
						});
					});

					if (session) {
						vscode.window.showInformationMessage(`✅ 认证成功！用户: ${session.account.label}`);
					} else {
						vscode.window.showErrorMessage('❌ 认证失败，可稍后运行 Sign In 命令重试');
					}
				}
			}

			// 最终验证
			await sleep(CONFIG_WRITE_DELAY);
			const verifyUri = getConfigValue('github-enterprise', 'uri');
			const verifyAuth = getConfigValue('github.copilot.advanced', 'authProvider');
			console.log(`[Setup] Final: URI=${verifyUri}, AuthProvider=${verifyAuth}, Session=${session?.account?.label || 'none'}`);

			// 提示重新加载
			const reload = await vscode.window.showInformationMessage(
				'🎉 配置完成！建议重新加载 VS Code 以确保所有更改生效',
				'重新加载',
				'稍后'
			);

			if (reload === '重新加载') {
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
			}

		} catch (error) {
			vscode.window.showErrorMessage(`配置失败: ${error.message}`);
			console.error('[Setup] Error:', error);
		}
	});

	// ================== 快速登录 ==================
	const signInCommand = vscode.commands.registerCommand('gheAuth.signIn', async () => {
		try {
			let gheUri = getConfigValue('github-enterprise', 'uri');

			if (!gheUri) {
				gheUri = await vscode.window.showInputBox({
					prompt: '输入 GitHub Enterprise Server URL',
					placeHolder: 'https://github.mycompany.com',
					validateInput: (value) => {
						if (!value) return 'URL 是必需的';
						if (!value.startsWith('https://')) return 'URL 必须以 https:// 开头';
						return null;
					}
				});

				if (!gheUri) return;
			}

			// 保存 URI + authProvider（始终确保两个都正确）
			await safeUpdateConfig('github-enterprise', 'uri', gheUri);
			await updateCopilotAdvanced('authProvider', 'github-enterprise');

			const session = await vscode.authentication.getSession('github-enterprise', ['user:email'], {
				createIfNone: true
			});

			if (session) {
				vscode.window.showInformationMessage(`✅ 已登录: ${session.account.label}`);

				const reload = await vscode.window.showInformationMessage(
					'认证成功！重新加载以应用更改？',
					'重新加载'
				);

				if (reload === '重新加载') {
					await vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`认证失败: ${error.message}`);
			console.error('[SignIn] Error:', error);
		}
	});

	// ================== 检查状态 ==================
	const checkCommand = vscode.commands.registerCommand('gheAuth.checkSession', async () => {
		const gheUri = getConfigValue('github-enterprise', 'uri');
		const authProvider = getConfigValue('github.copilot.advanced', 'authProvider');

		let statusLines = [
			'📊 当前配置状态：',
			'',
			`• GitHub Enterprise URI: ${gheUri || '❌ 未设置'}`,
			`• Auth Provider: ${authProvider || '❌ 未设置'}`
		];

		try {
			const session = await vscode.authentication.getSession('github-enterprise', ['user:email'], {
				createIfNone: false,
				silent: true
			});

			if (session) {
				statusLines.push(`• 登录状态: ✅ 已登录 (${session.account.label})`);
			} else {
				statusLines.push('• 登录状态: ❌ 未登录');
			}
		} catch {
			statusLines.push('• 登录状态: ❓ 无法检查');
		}

		if (gheUri && authProvider) {
			statusLines.push('', '✅ 配置完整');
		} else {
			statusLines.push('', '⚠️ 配置不完整，请运行 Setup 命令');
		}

		vscode.window.showInformationMessage(statusLines.join('\n'), { modal: true });
	});

	// ================== 打开配置文件 ==================
	const openSettingsCommand = vscode.commands.registerCommand('gheAuth.openSettings', async () => {
		await vscode.commands.executeCommand('workbench.action.openSettingsJson');
	});

	context.subscriptions.push(setupCommand, signInCommand, checkCommand, openSettingsCommand);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};
