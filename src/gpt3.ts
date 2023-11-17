/*
  This is a sample GPT-3 bot that uses the Promptable API to get a prompt and config
  and then uses the OpenAI API to generate a response.
  If you don't want to use Promptable, you can just hard-code your prompt and config
  somewhere in this file and replace the call to the Promptable API with a local call.
*/

import OpenAI from "openai";
import GPT3Tokenizer from "gpt3-tokenizer";
import axios from "axios";
import { ChatHistory, ChatHistoryStore, Turn } from "./chatHistory";
// import { PromptableApi } from "promptable";

// AI ASSISTANT BOT:
const DEFAULT_AGENT_NAME = "Assistant";
// const DEFAULT_PROMPT_ID = "clbilb0kh0008h7eg8jv8owdu";

const tokenizer = new GPT3Tokenizer({ type: "gpt3" });

function countBPETokens(text: string): number {
  const encoded = tokenizer.encode(text);
  return encoded.bpe.length;
}

const store = new ChatHistoryStore();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type OpenAIResponse = {
  text: string;
};

function leftTruncateTranscript(text: string, maxTokens: number): string {
  const encoded = tokenizer.encode(text);
  const numTokens = encoded.bpe.length;
  const truncated = encoded.bpe.slice(numTokens - maxTokens);
  const decoded = tokenizer.decode(truncated);
  return decoded;
}

function injectValuesIntoPrompt(
  template: string,
  values: { [key: string]: any }
): string {
  let result = template;
  for (const key in values) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), values[key]);
  }
  return result;
}

/*
 * If the message is "reset" or "reset <promptId> <agentName>", then reset the chat history
 * and return the new chat history. Otherwise, return null.
 */
function handlePossibleReset(
  phone: string,
  message: string
): ChatHistory | null {
  if (message.trim().toLowerCase() === "reset") {
    const promptId = `${Math.random()}`;
    const agentName = DEFAULT_AGENT_NAME;
    store.create(phone, agentName, promptId);
    return store.get(phone);
  }
  const pattern = /reset (\w+) (\w+)/;
  const match = message.toLowerCase().match(pattern);
  if (match) {
    const promptId = match[1];
    const agentName = match[2];
    store.create(phone, agentName, promptId);
    return store.get(phone);
  }
  return null;
}

/*
  Get or create a chat history for a phone number
*/
function getOrCreateChatHistory(phone: string, message: string) {
  let chatHistory = handlePossibleReset(phone, message);
  if (chatHistory == null) {
    chatHistory = store.get(phone);
    if (chatHistory == null) {
      chatHistory = store.create(phone, DEFAULT_AGENT_NAME, `${Math.random()}`);
    }
  } else {
    console.log("RESETTING CHAT HISTORY!");
    console.log(chatHistory);
  }
}

function formatChatHistoryTurns(turns: Turn[]) {
  return turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
}

function formatPromptText(chatHistory: ChatHistory, promptTemplate: string) {
  console.log("PromptTemplate", promptTemplate);
  const numTokens = countBPETokens(promptTemplate);
  let turnsText = formatChatHistoryTurns(chatHistory.turns);
  console.log("turnsText", turnsText);
  console.log("Pre Truncation", turnsText);
  turnsText = leftTruncateTranscript(turnsText, 4000 - numTokens);
  console.log("Post Truncation", turnsText);
  const prompt = injectValuesIntoPrompt(promptTemplate, { input: turnsText });
  console.log("Prompt", prompt);
  return prompt;
}

export const getReply = async (
  message: string,
  phoneNumber: string
): Promise<OpenAIResponse> => {
  console.log("Number", phoneNumber, "Message", message.trim());
  // strip whitespace!
  message = message.trim();
  getOrCreateChatHistory(phoneNumber, message);
  store.add(phoneNumber, message, "User");
  const chatHistory = store.get(phoneNumber);
  console.log("Chat History", chatHistory);

  // Get the prompt and config from the Promptable API
  // (Optionally) replace this call with a local hard-coded prompt and config
  // const data = await PromptableApi.getActiveDeployment({
  //   promptId: chatHistory.promptId,
  // });

  const data = {
    text: ``,
    config: {
      model: 'gpt-4',
      max_tokens: 1080,
      temperature: 1.0,
      stop: null
    }
  }

  console.log(data);

  const prompt = formatPromptText(chatHistory, data.text);
  console.log("PROMPT", prompt);
  const params = {
    prompt,
    model: data.config.model,
    max_tokens: data.config.max_tokens,
    temperature: data.config.temperature,
    stop: data.config.stop,
  };
  console.log(params);
  const response = await openai.chat.completions.create({
    messages: [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": message}
    ],
    model: 'gpt-4',
  });
  console.log(response);
  const agentText = response.choices[0]?.message.content || ''
  store.add(phoneNumber, agentText, chatHistory.agentName);
  console.log(`${chatHistory.agentName}: ${agentText}`);
  return {
    text: agentText,
  } as OpenAIResponse;
};