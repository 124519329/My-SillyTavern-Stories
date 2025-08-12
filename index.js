import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "My-SillyTavern-Stories";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ---【请在这里配置你的服务器信息】---
const SERVER_IP = "1.92.112.106"; 
const SECRET_KEY = "qweasd123"; 
// ------------------------------------

const SERVER_URL = `http://${SERVER_IP}`;
const API_BASE_URL = `${SERVER_URL}/api`;
const STORIES_BASE_PATH = `${SERVER_URL}/stories/`; 

const defaultSettings = {
    enabled: true,
};

// --- 全局变量 ---
let allStories = [];
let currentStory = null;

async function sendTextDirectly(text) {
    if (!text) return;

    // 优先尝试官方的 triggerSlash 函数，这是最正确、最高效的方式。
    if (typeof window.triggerSlash === 'function') {
        console.log("【小剧场库】找到 triggerSlash，正在直接发送文本...");
        await window.triggerSlash(text);
        return;
    }
    
    // 如果在特殊环境（如iframe）中，尝试父窗口的函数
    if (window.parent && typeof window.parent.triggerSlash === 'function') {
        console.log("【小剧场库】找到 parent.triggerSlash，正在直接发送文本...");
        await window.parent.triggerSlash(text);
        return;
    }

    // 如果连官方API都找不到，执行最后的备用方案
    console.error("【小剧场库】致命错误：未找到官方发送函数 triggerSlash！将回退到模拟输入。");
    const sendButton = $('#send_but');
    const inputTextArea = $('#send_textarea');
    if (sendButton.length > 0 && inputTextArea.length > 0) {
        const originalText = inputTextArea.val();
        inputTextArea.val(text);
        inputTextArea[0].dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => { 
            sendButton.click();
        }, 50);
    }
}
// ============================================================================


// --- API调用函数 ---
async function apiCall(endpoint, payload) {
    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, secret: SECRET_KEY })
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    return response.json();
}

// 打开编辑/上传窗口的函数
async function openEditModal(storyToEdit = null) {
    if ($("#story_upload_modal_overlay").length > 0) return;
    const uploadHtml = await $.get(`${extensionFolderPath}/upload.html`);
    $("body").append(uploadHtml);
    const isEditing = storyToEdit !== null;
    $("#story_upload_modal_content h3").text(isEditing ? "修改小剧场" : "上传新的小剧场");
    $("#submit_upload_btn").text(isEditing ? "确认修改" : "确认上传");
    if (isEditing) {
        $("#upload_title").val(storyToEdit.title);
        $("#upload_author").val(storyToEdit.author);
        $("#upload_tags").val(storyToEdit.tags.join(', '));
        $("#upload_content").val(storyToEdit.content);
    }
    $("#story_upload_close_btn").on("click", () => $("#story_upload_modal_overlay").remove());
    $("#submit_upload_btn").on("click", async () => {
        const payload = {
            id: isEditing ? storyToEdit.id : undefined,
            title: $("#upload_title").val(),
            author: $("#upload_author").val(),
            tags: $("#upload_tags").val().split(',').map(t => t.trim()).filter(Boolean),
            content: $("#upload_content").val(),
        };
        if (!payload.title || !payload.content) { $("#upload_status").text("错误：标题和内容不能为空！").css('color', 'red'); return; }
        $("#upload_status").text(isEditing ? "修改中..." : "上传中...");
        try {
            const endpoint = isEditing ? 'update' : 'upload';
            const result = await apiCall(endpoint, payload);
            if (result.success) {
                $("#upload_status").text(result.message).css('color', 'lightgreen');
                setTimeout(() => {
                    $("#story_upload_modal_overlay").remove();
                    closeLibraryModal();
                    openLibraryModal();
                }, 1500);
            } else { $("#upload_status").text(`错误: ${result.message}`).css('color', 'red'); }
        } catch (error) { console.error("操作失败:", error); $("#upload_status").text(`错误：${error.message}`).css('color', 'red'); }
    });
}

// 删除剧本的函数
async function deleteStory(storyToDelete) {
    if (!confirm(`确定要删除剧本 "${storyToDelete.title}" 吗？此操作不可恢复！`)) return;
    try {
        const result = await apiCall('delete', { id: storyToDelete.id });
        if (result.success) {
            alert(result.message);
            closeLibraryModal();
            openLibraryModal();
        } else {
            alert(`删除失败: ${result.message}`);
        }
    } catch (error) { console.error("删除失败:", error); alert(`删除失败：${error.message}`); }
}

function displayStoryContent() {
    if (!currentStory) return;
    $("#library_story_title").text(currentStory.title);
    $("#library_story_meta").html(`<span>作者: ${currentStory.author}</span> | <span>标签: ${currentStory.tags.join(', ')}</span>`);
    $("#library_story_content").text(currentStory.content);
    $("#library_actions").css('display', 'flex');
}

// renderStoryList 函数
function renderStoryList(stories) {
    const listContainer = $("#library_story_list_container").empty();
    if (stories.length === 0) { listContainer.append('<p>没有找到匹配的剧本。</p>'); return; }
    stories.forEach(storyData => {
        const item = $('<div class="library-story-item"></div>');
        const title = $('<span></span>').text(storyData.title);
        const actions = $('<div class="story-item-actions"></div>');
        const editBtn = $('<button class="story-item-btn" title="编辑">✏️</button>');
        const deleteBtn = $('<button class="story-item-btn" title="删除">🗑️</button>');
        editBtn.on('click', async (e) => {
            e.stopPropagation();
            try {
                const fullStory = await loadStory(storyData.id, true);
                if (fullStory) {
                    openEditModal(fullStory);
                } else { alert("加载剧本内容失败，无法编辑。"); }
            } catch (error) { console.error("编辑前加载失败:", error); alert("加载剧本内容失败，无法编辑。"); }
        });
        deleteBtn.on('click', (e) => { e.stopPropagation(); deleteStory(storyData); });
        actions.append(editBtn, deleteBtn);
        item.append(title, actions);
        item.on('click', function() {
            $(".library-story-item.active").removeClass('active');
            $(this).addClass('active');
            loadStory(storyData.id);
        });
        listContainer.append(item);
    });
}

// loadStory 函数
async function loadStory(storyId, returnStory = false) {
    try {
        const response = await fetch(`${STORIES_BASE_PATH}${storyId}.json?t=${new Date().getTime()}`);
        if (!response.ok) throw new Error('Network response was not ok.');
        const storyContent = await response.json();
        const storyIndex = allStories.findIndex(s => s.id === storyId);
        if(storyIndex > -1) {
            allStories[storyIndex] = { ...allStories[storyIndex], ...storyContent };
        }
        currentStory = storyContent;
        displayStoryContent();
        if (returnStory) return currentStory;
    } catch (error) { 
        console.error("小剧场库: 加载剧本文件失败", error);
        $("#library_story_content").text('加载剧本内容失败。');
        if (returnStory) return null;
    }
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], { ...defaultSettings, ...extension_settings[extensionName] });
    $("#enable_story_library").prop("checked", extension_settings[extensionName].enabled);
}

function onEnableChange() {
    extension_settings[extensionName].enabled = $("#enable_story_library").prop("checked");
    saveSettingsDebounced();
}

function closeLibraryModal() {
    $("#story_library_modal_overlay").remove();
}

async function openLibraryModal() {
    if ($("#story_library_modal_overlay").length > 0) return;
    const modalHtml = await $.get(`${extensionFolderPath}/library.html`);
    $("body").append(modalHtml);
    
    function handleSearchAndFilter() {
        const searchTerm = $("#story_search_input").val().toLowerCase();
        const activeTag = $(".library-tag-btn.active").data('tag');
        let filteredStories = allStories;
        if (activeTag !== 'all' && activeTag) { filteredStories = filteredStories.filter(s => s.tags.includes(activeTag)); }
        if (searchTerm) { filteredStories = filteredStories.filter(s => s.title.toLowerCase().includes(searchTerm)); }
        renderStoryList(filteredStories);
    }

    function renderTags() {
        const tagContainer = $("#library_tag_container").empty();
        const tags = new Set(['all', ...allStories.flatMap(story => story.tags)]);
        tags.forEach(tag => {
            const btn = $('<button class="library-tag-btn"></button').data('tag', tag).text(tag === 'all' ? '全部' : tag);
            if (tag === 'all') btn.addClass('active');
            btn.on('click', function() { $(".library-tag-btn.active").removeClass('active'); $(this).addClass('active'); handleSearchAndFilter(); });
            tagContainer.append(btn);
        });
    }

    async function initStoryLibrary() {
        const INDEX_PATH = `${SERVER_URL}/index.json`;
        try {
            const response = await fetch(INDEX_PATH + '?t=' + new Date().getTime());
            if (!response.ok) throw new Error('Network response was not ok.');
            allStories = await response.json();
            renderTags();
            handleSearchAndFilter();
        } catch (error) { console.error("小剧场库: 加载 index.json 失败!", error); $("#library_tag_container").html(`<p>加载索引失败。</p>`); }
    }

    $("#story_library_close_btn").on("click", closeLibraryModal);
    $("#story_library_modal_overlay").on("click", function(event) { if (event.target === this) closeLibraryModal(); });
    $("#story_search_input").on('input', handleSearchAndFilter);
    $("#open_upload_modal_btn").on("click", () => openEditModal(null));
    $("#library_send_btn").on("click", () => {
        if (currentStory && currentStory.content) {
            sendTextDirectly(currentStory.content);
            closeLibraryModal();
        } else { alert("请先从左侧列表中选择一个剧本！"); }
    });
    
    await initStoryLibrary();
}

jQuery(async () => {
    try {
        // 加载插件设置到 "Extensions" 面板
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);
        
        // 为“启用小剧场库”复选框绑定事件
        $("#enable_story_library").on("input", onEnableChange);
        
        // 加载用户设置
        await loadSettings();
        
        // 【新增功能】将“小剧场库”按钮也添加到左侧的扩展菜单中
        function addLibraryButtonToExtensionsMenu() {
            // 只有在插件启用时才添加按钮
            if (extension_settings[extensionName]?.enabled) {
                const extensionsMenu = $('#extensionsMenu');
                if (extensionsMenu.length > 0) {
                    // 避免重复添加按钮
                    if ($('#story_library_in_extension_menu_btn').length === 0) {
                         const menuButtonHtml = `
                            <div id="story_library_in_extension_menu_btn" class="list-group-item flex-container flexGap5 interactable">
                                <div class="fa-solid fa-book-open extensionsMenuExtensionButton"></div>
                                <span>小剧场库</span>
                            </div>
                        `;
                        extensionsMenu.append(menuButtonHtml);
                        $('#story_library_in_extension_menu_btn').on('click', openLibraryModal);
                    }
                }
            } else {
                 // 如果插件被禁用，则移除按钮
                 $('#story_library_in_extension_menu_btn').remove();
            }
        }

        // 首次加载时和每次启用/禁用插件时都更新扩展菜单中的按钮
        addLibraryButtonToExtensionsMenu();
        $("#enable_story_library").on("input", addLibraryButtonToExtensionsMenu);

    } catch (error) {
        console.error(`加载插件【${extensionName}】时发生严重错误:`, error);
    }
});

