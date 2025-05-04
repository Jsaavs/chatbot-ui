const handleSendMessage = async (
  messageContent: string,
  chatMessages: ChatMessage[],
  isRegeneration: boolean
) => {
  const startingInput = messageContent;

  try {
    setUserInput("");
    setIsGenerating(true);
    setIsPromptPickerOpen(false);
    setIsFilePickerOpen(false);
    setNewMessageImages([]);

    const newAbortController = new AbortController();
    setAbortController(newAbortController);

    const modelData = [
      ...models.map(model => ({
        modelId: model.model_id as LLMID,
        modelName: model.name,
        provider: "custom" as ModelProvider,
        hostedId: model.id,
        platformLink: "",
        imageInput: false
      })),
      ...LLM_LIST,
      ...availableLocalModels,
      ...availableOpenRouterModels
    ].find(llm => llm.modelId === chatSettings?.model);

    validateChatSettings(
      chatSettings,
      modelData,
      profile,
      selectedWorkspace,
      messageContent
    );

    let currentChat = selectedChat ? { ...selectedChat } : null;

    const b64Images = newMessageImages.map(image => image.base64);

    let retrievedFileItems: Tables<"file_items">[] = [];

    if (
      (newMessageFiles.length > 0 || chatFiles.length > 0) &&
      useRetrieval
    ) {
      setToolInUse("retrieval");

      retrievedFileItems = await handleRetrieval(
        userInput,
        newMessageFiles,
        chatFiles,
        chatSettings!.embeddingsProvider,
        sourceCount
      );
    }

    const { tempUserChatMessage, tempAssistantChatMessage } =
      createTempMessages(
        messageContent,
        chatMessages,
        chatSettings!,
        b64Images,
        isRegeneration,
        setChatMessages,
        selectedAssistant
      );

    let payload: ChatPayload = {
      chatSettings: chatSettings!,
      workspaceInstructions: selectedWorkspace!.instructions || "",
      chatMessages: isRegeneration
        ? [...chatMessages]
        : [...chatMessages, tempUserChatMessage],
      assistant: selectedChat?.assistant_id ? selectedAssistant : null,
      messageFileItems: retrievedFileItems,
      chatFileItems: chatFileItems
    };

    let generatedText = "";

    if (selectedTools.length > 0) {
      setToolInUse("Tools");

      const formattedMessages = await buildFinalMessages(
        payload,
        profile!,
        chatImages
      );

      // BLOQUE CORREGIDO
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/chat/tools`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chatSettings: payload.chatSettings,
            messages: formattedMessages,
            selectedTools
          })
        }
      );

      setToolInUse("none");

      generatedText = await processResponse(
        response,
        isRegeneration
          ? payload.chatMessages[payload.chatMessages.length - 1]
          : tempAssistantChatMessage,
        true,
        newAbortController,
        setFirstTokenReceived,
        setChatMessages,
        setToolInUse
      );
    } else {
      if (modelData!.provider === "ollama") {
        generatedText = await handleLocalChat(
          payload,
          profile!,
          chatSettings!,
          tempAssistantChatMessage,
          isRegeneration,
          newAbortController,
          setIsGenerating,
          setFirstTokenReceived,
          setChatMessages,
          setToolInUse
        );
      } else {
        generatedText = await handleHostedChat(
          payload,
          profile!,
          modelData!,
          tempAssistantChatMessage,
          isRegeneration,
          newAbortController,
          newMessageImages,
          chatImages,
          setIsGenerating,
          setFirstTokenReceived,
          setChatMessages,
          setToolInUse
        );
      }
    }

    if (!currentChat) {
      currentChat = await handleCreateChat(
        chatSettings!,
        profile!,
        selectedWorkspace!,
        messageContent,
        selectedAssistant!,
        newMessageFiles,
        setSelectedChat,
        setChats,
        setChatFiles
      );
    } else {
      const updatedChat = await updateChat(currentChat.id, {
        updated_at: new Date().toISOString()
      });

      setChats(prevChats => {
        const updatedChats = prevChats.map(prevChat =>
          prevChat.id === updatedChat.id ? updatedChat : prevChat
        );

        return updatedChats;
      });
    }

    await handleCreateMessages(
      chatMessages,
      currentChat,
      profile!,
      modelData!,
      messageContent,
      generatedText,
      newMessageImages,
      isRegeneration,
      retrievedFileItems,
      setChatMessages,
      setChatFileItems,
      setChatImages,
      selectedAssistant
    );

    setIsGenerating(false);
    setFirstTokenReceived(false);
  } catch (error) {
    setIsGenerating(false);
    setFirstTokenReceived(false);
    setUserInput(startingInput);
  }
};
