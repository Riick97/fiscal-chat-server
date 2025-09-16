import path from "path";
import { AzureOpenAI } from "openai";
import { HNSWLib } from "langchain/vectorstores/hnswlib";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { VectorDBQAChain } from "langchain/chains";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { PromptTemplate } from "langchain/prompts";
import { ChainTool } from "langchain/tools";
import { getSystemTemplate } from "./utilsPrompts.js";
import { SerpAPI } from "langchain/tools";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Azure OpenAI configuration
const azureOpenAIKey = process.env.AZURE_OPENAI_API_KEY;
const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureApiVersion =
  process.env.AZURE_OPENAI_API_VERSION || "2024-04-01-preview";
const azureDeploymentName =
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4.1";
const azureEmbeddingsDeploymentName =
  process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT_NAME ||
  "text-embedding-ada-002";
const azureModelName = process.env.AZURE_OPENAI_MODEL_NAME || "gpt-4.1";

// Validate required environment variables
if (!azureOpenAIKey || !azureEndpoint) {
  throw new Error(
    "Missing required Azure OpenAI environment variables. Please check your .env file."
  );
}

// Create Azure OpenAI client
const azureClient = new AzureOpenAI({
  endpoint: azureEndpoint,
  apiKey: azureOpenAIKey,
  deployment: azureDeploymentName,
  apiVersion: azureApiVersion,
});

// Your actual token emitter function
export const getTokenEmmiter = async (
  onTokenStream,
  chatMode,
  option2,
  option3,
  option4
) => {
  // Set up the vector store (assumes you have a vector store directory)
  const dir = path.resolve(process.cwd(), "data");
  const vectorstore = await HNSWLib.load(
    dir,
    new OpenAIEmbeddings({
      maxRetries: 2,
      maxConcurrency: 5,
      timeout: 1000,
      modelName: "text-embedding-ada-002",
      azureOpenAIApiKey: azureOpenAIKey,
      azureOpenAIApiVersion: azureApiVersion,
      azureOpenAIApiInstanceName: azureEndpoint
        .replace("https://", "")
        .replace(".cognitiveservices.azure.com/", ""),
      azureOpenAIApiDeploymentName: azureEmbeddingsDeploymentName,
    })
  );

  // Function to search vector store
  const searchVectorStore = async (query) => {
    try {
      const results = await vectorstore.similaritySearch(query, 5);
      return results.map((doc) => doc.pageContent).join("\n\n");
    } catch (error) {
      console.error("Vector store search error:", error);
      return "";
    }
  };

  // Function to get tools based on option
  const getToolsInfo = (option = "") => {
    const normalizedOption = option?.toLowerCase();
    return {
      hasVectorTool: ["wetbundel", "combinatie", "debugging", ""].includes(
        normalizedOption
      ),
      hasInternetTool: ["internet", "combinatie"].includes(normalizedOption),
    };
  };

  const toolsInfo = getToolsInfo(chatMode);
  const systemTemplate = getSystemTemplate(chatMode, option2, option3, option4);

  // Set up a prompt template
  const promptTemplate = PromptTemplate.fromTemplate(
    `Task: {question}\n\n${systemTemplate}\n\nChat History: {history}`
  );

  console.log({ promptTemplate });

  // Return a caller object that handles the execution logic
  return {
    async call({ question, chat_history }) {
      // Format the chat history
      const prefixMessages = chat_history
        .map((message) => [
          {
            role: "user",
            content: message[0],
          },
          {
            role: "assistant",
            content: message[1],
          },
        ])
        .flat();

      // Search vector store if needed
      let contextFromVectorStore = "";
      if (toolsInfo.hasVectorTool) {
        contextFromVectorStore = await searchVectorStore(question);
      }

      // Format the prompt
      const formattedChatPrompt = await promptTemplate.format({
        question: question,
        history: JSON.stringify(prefixMessages),
      });

      // Prepare messages for Azure OpenAI
      const messages = [
        {
          role: "system",
          content: `${formattedChatPrompt}${
            contextFromVectorStore
              ? `\n\nContext from Fiscal Law Database:\n${contextFromVectorStore}`
              : ""
          }`,
        },
        ...prefixMessages,
        {
          role: "user",
          content: question,
        },
      ];

      try {
        // Use Azure OpenAI streaming
        const stream = await azureClient.chat.completions.create({
          model: azureModelName,
          messages: messages,
          max_tokens: 13107,
          temperature: 0,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          stream: true,
        });

        let fullResponse = "";

        for await (const chunk of stream) {
          if (chunk.choices[0]?.delta?.content) {
            const token = chunk.choices[0].delta.content;
            fullResponse += token;
            onTokenStream(token);
          }
        }

        return fullResponse;
      } catch (error) {
        console.error("Error executing the task:", error);
        throw error;
      }
    },
  };
};
