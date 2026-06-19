// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { MrcEditorProvider } from './mrcEditorProvider';

// This method is called when your extension is activated.
export function activate(context: vscode.ExtensionContext) {
	console.log('mrc-viewer is now active');
	context.subscriptions.push(MrcEditorProvider.register(context));
}

// This method is called when your extension is deactivated.
export function deactivate() {}
