/*
  This is a sample GPT-3 bot that uses the Promptable API to get a prompt and config
  and then uses the OpenAI API to generate a response.
  If you don't want to use Promptable, you can just hard-code your prompt and config
  somewhere in this file and replace the call to the Promptable API with a local call.
*/

const { Configuration, OpenAIApi } = require("openai");
import GPT3Tokenizer from "gpt3-tokenizer";
import axios from "axios";
import { ChatHistory, ChatHistoryStore, Turn } from "./chatHistory";
import { PromptableApi } from "promptable";

// AI ASSISTANT BOT:
const DEFAULT_AGENT_NAME = "Assistant";
const DEFAULT_PROMPT_ID = "clbilb0kh0008h7eg8jv8owdu";

const tokenizer = new GPT3Tokenizer({ type: "gpt3" });

function countBPETokens(text: string): number {
  const encoded = tokenizer.encode(text);
  return encoded.bpe.length;
}

const store = new ChatHistoryStore();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

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
    const promptId = DEFAULT_PROMPT_ID;
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
      chatHistory = store.create(phone, DEFAULT_AGENT_NAME, DEFAULT_PROMPT_ID);
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
  const data = await PromptableApi.getActiveDeployment({
    promptId: chatHistory.promptId,
  });

  console.log(data);

  const prompt = formatPromptText(chatHistory, data.text);
  console.log("PROMPT", prompt);
  const params = {
    prompt,
    model: "text-davinci-003",
  prompt: "You are an information retrieval assistant. You started a group chat with Sender and Recipient. You converse with the users and extract and display a JSON representation of the following data points:

1. Recipient Email
2. User Date/Time Preferences

Emails must have the format "someString@someDomain.something"

If there is no data, the value should be null

If the user does not explicitly provide their email, then you ask them for their email.

You always ask for clarification any self-inconsistencies.

Example JSON format:

{
  "Recipient Email": "[fizzybuzzy@foo.co.uk](mailto:fizzybuzzy@foo.co.uk)",
  "User Date/Time Preferences": {
    "Sender": {
      "Available Days": ["Monday", "Tuesday", "Thursday", "Friday", "Saturday", "Sunday"],
      "Available Times": ["Morning", "Afternoon", "Evening"]
    },
    "Recipient": {
      "Available Days": ["Wednesday", "Thursday"],
      "Available Times": ["Evening"]
    }
  }
}

Once you have retrieved these items, ask for a final confirmation with all the calendar event details. Do not send confirmation of the JSON details in the chat.

You need to ensure you have all of the following: 

1. Recipient Name
2. Recipient #
3. Sender's time pref
4. Recipient's Email
5. Recipient's Timezone
6. Recipient's confirmed date + time
7. User's confirmed date + time

Then, ask the original sender if they confirm the proposed calendar details.

Once you have confirmation,
"I am done getting all the details from both of you."
",
  temperature: 0.7,
  max_tokens: 256,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  };
  console.log(params);
  const response = await openai.createCompletion(params);
  console.log(response.data);
  const agentText = response.data.choices[0].text.trim();
  store.add(phoneNumber, agentText, chatHistory.agentName);
  console.log(`${chatHistory.agentName}: ${agentText}`);
  return {
    text: agentText,
  } as OpenAIResponse;
};