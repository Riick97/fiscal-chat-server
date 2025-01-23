import path from "path";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HNSWLib } from "langchain/vectorstores/hnswlib";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { VectorDBQAChain } from "langchain/chains";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { PromptTemplate } from "langchain/prompts";
import { ChainTool } from "langchain/tools";
import { getSystemTemplate } from "./utilsPrompts.js"; // Note: .js extension is required
import { SerpAPI } from "langchain/tools";

// Assuming these values are used to interact with Azure OpenAI
const azureOpenAIKey = "143bedd78b51497f894c7bf36d4aadcf"; // Replace with actual key
const azureInstanceName = "CAEDAOIPOCAOA07"; // Replace with actual instance name
const azureDeploymentName = "analyze-your-data"; // Replace with actual deployment name
const azureEmbeddingsDeploymentName = "analyze-your-data-embeddings"; // Replace with actual embeddings deployment name

// Your actual token emitter function
export const getTokenEmmiter = async (
  onTokenStream,
  chatMode,
  option2,
  option3,
  option4
) => {
  // Create a ChatOpenAI instance for the model
  const chatModel = new ChatOpenAI({
    azureOpenAIApiKey: azureOpenAIKey,
    azureOpenAIApiVersion: "2023-07-01-preview",
    azureOpenAIApiInstanceName: azureInstanceName,
    azureOpenAIApiDeploymentName: azureDeploymentName,
    temperature: 0,
    streaming: true,
  });

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
      azureOpenAIApiVersion: "2023-07-01-preview",
      azureOpenAIApiInstanceName: azureInstanceName,
      azureOpenAIApiDeploymentName: azureEmbeddingsDeploymentName,
    })
  );

  // Create a VectorDBQAChain from the vector store
  const vectorDBChainTool = VectorDBQAChain.fromLLM(chatModel, vectorstore);

  const internetTool = new SerpAPI();

  // Create a ChainTool for specific tasks
  const qaTool = new ChainTool({
    name: "Fiscale-wettenbundel-Curacao-2020",
    description: `This tool provides access to the Fiscale wettenbundel Curacao 2020. Use it to retrieve specific information about the tax law for the user. use the Algemene inhoudsopgave to find your way through the document.`,
    chain: vectorDBChainTool,
  });

  // Function to get tools based on option
  const getTools = (option = "") => {
    // Convert option to lowercase for case-insensitive comparison
    const normalizedOption = option?.toLowerCase();

    switch (normalizedOption) {
      case "wetbundel":
        return [qaTool];
      case "internet":
        return [internetTool];
      case "combinatie":
        return [qaTool, internetTool];
      case "debugging":
        return [qaTool];
      default:
        // Default to qaTool when option is empty or not recognized
        return [qaTool];
    }
  };

  const tools = getTools(chatMode);

  // Initialize the agent with options for running tasks
  const executor = await initializeAgentExecutorWithOptions(tools, chatModel, {
    agentType:
      chatMode === "debugging"
        ? "chat-zero-shot-react-description"
        : "openai-functions", // for: debug mode
    verbose: true,
  });

  const systemTemplate = getSystemTemplate(chatMode, option2, option3, option4);

  // console.log("System template:", systemTemplate);

  // Set up a prompt template
  const promptTemplate = PromptTemplate.fromTemplate(
    `Task: {question}\n\n${systemTemplate}\n\nChat History: {history}`
  );

  // Return a caller object that handles the execution logic
  return {
    async call({ question, chat_history }) {
      // Format the chat history as required by the model
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

      // Format the chat prompt using the prompt template
      const formattedChatPrompt = await promptTemplate.format({
        question: question,
        history: JSON.stringify(prefixMessages),
      });

      try {
        // Run the model and stream the tokens
        const result = await executor.run(formattedChatPrompt, {
          callbacks: [
            {
              handleLLMNewToken(token) {
                // Forward each new token to the client
                onTokenStream(token);
              },
            },
          ],
        });

        return result;
      } catch (error) {
        console.error("Error executing the task:", error);
        throw error;
      }
    },
  };
};
