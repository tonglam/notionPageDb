import { deepseek } from "@ai-sdk/deepseek";
import { generateText } from "ai";
import axios from "axios";
import * as fs from "fs-extra";
import * as path from "path";
import { AIConfig, ImageResult, SummaryOptions } from "../../types";
import { IAIService } from "./AIService.interface";

/**
 * Implementation of the AIService using API services
 * Handles AI-powered content enhancement and image generation
 */
export class AIService implements IAIService {
  private dashscopeApiKey: string;
  private modelName: string;
  private readonly AVAILABLE_MODELS = [
    "deepseek-reasoner",
    "deepseek-chat",
  ] as const;

  /**
   * Creates a new AIService instance
   * @param config The AI service configuration
   */
  constructor(config: AIConfig) {
    this.modelName = this.validateModel(config.model) || "deepseek-reasoner";
    this.dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";

    if (!this.dashscopeApiKey) {
      console.warn(
        "DASHSCOPE_API_KEY environment variable is not set. Image generation will not work."
      );
    }

    if (!config.apiKey) {
      console.warn(
        "Deepseek API key is not set. Text generation will not work."
      );
    }
  }

  /**
   * Switch between available models
   * @param modelName The model to switch to
   */
  public switchModel(modelName: (typeof this.AVAILABLE_MODELS)[number]): void {
    this.modelName = this.validateModel(modelName) || this.modelName;
  }

  /**
   * Validate if the model name is supported
   * @param modelName The model name to validate
   */
  private validateModel(
    modelName?: string
  ): (typeof this.AVAILABLE_MODELS)[number] | undefined {
    return modelName && this.AVAILABLE_MODELS.includes(modelName as any)
      ? (modelName as (typeof this.AVAILABLE_MODELS)[number])
      : undefined;
  }

  /**
   * Generates a summary of the text content
   * @param content The content to summarize
   * @param options Options for summary generation
   */
  async generateSummary(
    content: string,
    options?: SummaryOptions
  ): Promise<string> {
    const maxLength = options?.maxLength || 250;

    try {
      const { text } = await generateText({
        model: deepseek(this.modelName),
        messages: [
          {
            role: "user",
            content: `You are an expert summarizer. Your task is to create concise, informative summaries that capture the key points of technical articles. Please provide a concise summary (maximum 3 sentences) of the following technical article. Highlight the key technologies, concepts, and takeaways. Do NOT include "Summary:" or any other prefix in your response, just provide the summary directly:\n\n${content}`,
          },
        ],
      });

      const summary = text.trim();

      // Ensure the summary is within the maxLength constraint
      return summary.length > maxLength
        ? summary.substring(0, maxLength - 3) + "..."
        : summary;
    } catch (error) {
      console.error("Error generating summary:", error);
      // Fallback to a simple summary if AI fails
      return content.substring(0, maxLength - 3) + "...";
    }
  }

  /**
   * Generates an optimized title based on content
   * @param content The content to base the title on
   * @param currentTitle The current title, if any
   * @param maxLength Maximum length of the title
   */
  async generateTitle(
    content: string,
    currentTitle?: string,
    maxLength = 70
  ): Promise<string> {
    // Truncate content if too long
    const truncatedContent =
      content.length > 2000 ? content.substring(0, 2000) + "..." : content;

    try {
      const { text } = await generateText({
        model: deepseek(this.modelName),
        messages: [
          {
            role: "user",
            content: currentTitle
              ? `Based on the following content, suggest an improved, engaging, and SEO-friendly title. The current title is "${currentTitle}", but feel free to suggest a completely different title if appropriate. Title should be no longer than ${maxLength} characters:\n\n${truncatedContent}`
              : `Create an engaging, SEO-friendly title for the following content, no longer than ${maxLength} characters:\n\n${truncatedContent}`,
          },
        ],
      });

      let title = text.trim();

      // Remove quotes if present (AI often puts titles in quotes)
      title = title.replace(/^['"](.*)['"]$/, "$1");

      // Ensure the title is within length constraints
      return title.length > maxLength
        ? title.substring(0, maxLength - 3) + "..."
        : title;
    } catch (error) {
      console.error("Error generating title:", error);
      // Fallback to current title or a generic one
      return currentTitle || "Untitled";
    }
  }

  /**
   * Generates keywords and tags from content
   * @param content The content to extract keywords from
   * @param maxKeywords Maximum number of keywords to extract
   */
  async generateKeywords(content: string, maxKeywords = 10): Promise<string[]> {
    // Truncate content if too long
    const truncatedContent =
      content.length > 3000 ? content.substring(0, 3000) + "..." : content;

    try {
      const { text } = await generateText({
        model: deepseek(this.modelName),
        messages: [
          {
            role: "user",
            content: `Extract ${maxKeywords} relevant keywords or keyphrases from the following content. Provide them as a comma-separated list. Focus on terms that would work well as tags or for SEO:\n\n${truncatedContent}`,
          },
        ],
      });

      const keywordsText = text.trim();

      // Split by commas and clean up each keyword
      const keywords = keywordsText
        .split(/,\s*/)
        .map((keyword: string) => keyword.trim())
        .filter((keyword: string) => keyword.length > 0)
        .slice(0, maxKeywords);

      return keywords;
    } catch (error) {
      console.error("Error generating keywords:", error);
      // Fallback to simple word extraction
      return content
        .split(/\s+/)
        .filter((word: string) => word.length > 5)
        .slice(0, maxKeywords);
    }
  }

  /**
   * Validates the content based on business rules
   * @param content The content to validate
   * @param rules The validation rules to apply
   */
  async validateContent(content: string, rules: string[]): Promise<boolean> {
    // Truncate content if too long
    const truncatedContent =
      content.length > 3000 ? content.substring(0, 3000) + "..." : content;

    // Format rules into a readable string
    const rulesText = rules
      .map((rule, index) => `Rule ${index + 1}: ${rule}`)
      .join("\n");

    try {
      const { text } = await generateText({
        model: deepseek(this.modelName),
        messages: [
          {
            role: "user",
            content: `Validate if the following content complies with all the rules specified. Respond with ONLY "true" if all rules are satisfied, or "false" if any rule is violated.\n\nRULES:\n${rulesText}\n\nCONTENT:\n${truncatedContent}`,
          },
        ],
      });

      const result = text.trim().toLowerCase();
      return result === "true";
    } catch (error) {
      console.error("Error validating content:", error);
      // Conservative approach: if validation fails, assume content doesn't meet rules
      return false;
    }
  }

  /**
   * Generates an image for the content using DashScope API
   * @param prompt The text prompt to generate the image from
   * @param options Options for image generation
   */
  public async generateImage(
    prompt: string,
    options?: {
      width?: number;
      height?: number;
      localPath?: string;
      maxAttempts?: number;
      checkInterval?: number;
    }
  ): Promise<ImageResult> {
    if (!this.dashscopeApiKey) {
      return {
        url: "",
        prompt,
        success: false,
        error: "DASHSCOPE_API_KEY is not set. Cannot generate image.",
      };
    }

    try {
      const enhancedPrompt = this.enhanceImagePrompt(prompt);
      const size =
        options?.width && options?.height
          ? `${options.width}*${options.height}`
          : "1024*1024";

      const negative_prompt =
        "text, words, writing, watermark, signature, blurry, low quality, ugly, distorted, photorealistic, photograph, human faces, hands, cluttered, chaotic layout, overly complex, childish, cartoon-like, unprofessional, Chinese characters, Chinese text, Asian characters, characters, text overlay, letters, numbers, any text, Asian text";

      console.log("Creating image generation task with DashScope API");

      // Step 1: Create an image generation task
      const createTaskResponse = await axios.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        {
          model: "wanx2.1-t2i-turbo",
          input: {
            prompt: enhancedPrompt,
            negative_prompt: negative_prompt,
          },
          parameters: {
            size: size,
            n: 1,
          },
        },
        {
          headers: {
            "X-DashScope-Async": "enable",
            Authorization: `Bearer ${this.dashscopeApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Extract task_id from the response
      if (
        !createTaskResponse.data ||
        !createTaskResponse.data.output ||
        !createTaskResponse.data.output.task_id
      ) {
        return {
          url: "",
          prompt,
          success: false,
          error: "No task ID returned from DashScope API",
        };
      }

      const taskId = createTaskResponse.data.output.task_id;
      console.log(`Task created successfully with ID: ${taskId}`);

      // Step 2: Poll for the task result
      const imageUrl = await this.getDashScopeImageResult(
        taskId,
        options?.maxAttempts,
        options?.checkInterval
      );

      if (!imageUrl) {
        return {
          url: "",
          prompt,
          taskId,
          success: false,
          error: "Failed to get image URL from DashScope API",
        };
      }

      // Download the image if a local path is specified
      if (options?.localPath) {
        try {
          const localPath = await this.downloadImage(
            imageUrl,
            options.localPath
          );
          return {
            url: imageUrl,
            localPath,
            prompt,
            taskId,
            success: true,
          };
        } catch (error) {
          console.error("Error generating image with DashScope:", error);
          return {
            url: "",
            prompt,
            taskId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        url: imageUrl,
        prompt,
        taskId,
        success: true,
      };
    } catch (error) {
      console.error("Error generating image with DashScope:", error);
      return {
        url: "",
        prompt,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Polls for the DashScope image generation task result
   * @param taskId The task ID to check
   * @param maxAttempts Maximum number of attempts
   * @param checkInterval Interval between checks in milliseconds
   * @returns The URL of the generated image, or null if generation failed
   */
  private async getDashScopeImageResult(
    taskId: string,
    maxAttempts = 15,
    checkInterval = 5000
  ): Promise<string | null> {
    try {
      console.log(`Checking status for DashScope task: ${taskId}`);
      let attempts = 0;

      while (attempts < maxAttempts) {
        attempts++;
        console.log(`Attempt ${attempts}/${maxAttempts}...`);

        const response = await axios.get(
          `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
          {
            headers: {
              Authorization: `Bearer ${this.dashscopeApiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.data || !response.data.output) {
          console.error("Unexpected response format:", response.data);
          return null;
        }

        const status = response.data.output.task_status;
        console.log(`Current status: ${status}`);

        if (status === "SUCCEEDED") {
          console.log("Task completed successfully!");
          // Extract the image URL from the result
          if (
            response.data.output.results &&
            response.data.output.results.length > 0
          ) {
            const imageUrl = response.data.output.results[0].url;
            console.log(`Generated image URL: ${imageUrl}`);
            return imageUrl;
          } else {
            console.error("No image URL in successful response");
            return null;
          }
        } else if (status === "FAILED") {
          console.error("Task failed:", response.data.output.error);
          return null;
        }

        console.log(
          `Waiting ${checkInterval / 1000} seconds before next check...`
        );
        await this.delay(checkInterval);
      }

      console.error(`Max attempts (${maxAttempts}) reached without completion`);
      return null;
    } catch (error) {
      console.error("Error checking task status:", error);
      return null;
    }
  }

  /**
   * Downloads an image from a URL to a local path
   * @param url URL of the image to download
   * @param localPath Path to save the image to
   */
  private async downloadImage(url: string, localPath: string): Promise<string> {
    try {
      // Create directory if it doesn't exist
      await fs.ensureDir(path.dirname(localPath));

      // Download the image
      const response = await axios.get(url, {
        responseType: "arraybuffer",
      });

      // Write the file directly
      await fs.writeFile(localPath, response.data);
      return localPath;
    } catch (error) {
      console.error("Error generating image with DashScope:", error);
      throw error;
    }
  }

  /**
   * Utility method to delay execution
   * @param ms Milliseconds to delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Enhances a prompt for better image generation
   * @param prompt The original prompt
   * @returns The enhanced prompt
   */
  private enhanceImagePrompt(prompt: string): string {
    // Clean and enhance the prompt
    const cleanPrompt = prompt.replace(/['"]/g, "").trim();

    // Create a structured prompt based on the advanced formula
    // 提示词 = 主体描述 + 场景描述 + 风格定义 + 镜头语言 + 光线设置 + 氛围词 + 细节修饰 + 技术参数

    // Main subject description
    const subjectDescription = `a professional technical illustration representing the concept of "${cleanPrompt}" WITHOUT ANY TEXT OR LABELS`;

    // Scene description
    const sceneDescription =
      "in a clean, minimalist digital environment with subtle tech-related background elements";

    // Style definition
    const styleDefinition =
      "modern digital art style with clean lines and a professional look, suitable for technical articles";

    // Camera language
    const cameraLanguage =
      "frontal perspective with balanced composition, moderate depth of field focusing on the central concept";

    // Lighting setup
    const lightingSetup =
      "soft, even lighting with subtle highlights to emphasize important elements, cool blue accent lighting";

    // Atmosphere words
    const atmosphereWords =
      "informative, innovative, precise, and engaging atmosphere";

    // Detail modifiers
    const detailModifiers =
      "with subtle grid patterns, simplified icons or symbols related to the prompt, using a cohesive color palette of blues, teals, and neutral tones";

    // Technical parameters
    const technicalParameters =
      "high-resolution, sharp details, professional vector-like quality";

    // Combine all components into a comprehensive prompt
    return `${subjectDescription} ${sceneDescription}. 
    Style: ${styleDefinition}. 
    Composition: ${cameraLanguage}. 
    Lighting: ${lightingSetup}. 
    Atmosphere: ${atmosphereWords}. 
    Details: ${detailModifiers}. 
    Quality: ${technicalParameters}.
    
    The illustration should visually communicate the key concepts: ${cleanPrompt}
    
    IMPORTANT: DO NOT INCLUDE ANY TEXT, WORDS, LABELS, OR CHARACTERS IN THE IMAGE. The illustration should be entirely visual without any textual elements.`;
  }
}
