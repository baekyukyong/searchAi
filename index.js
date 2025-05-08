//필요한 모듈 로딩 : 서버를 만들기 위한 도구들들
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios'); // API 요청 보내는 라이브러리리

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json()); //외부에서 JSON을 받을 수 있게 설정함함

app.use(express.static(path.join(__dirname, 'build')));

// Vision API 정보 설정
const VISION_ENDPOINT = 'https://vision-api-gb.cognitiveservices.azure.com//vision/v3.2/analyze?visualFeatures=Description,Tags&language=en';
const VISION_KEY = '3wjxKTjzRfgtNSJbEvjoZbA2UyDADBdMZOJLzBUw6tYXWXX3bgbEJQQJ99BDACNns7RXJ3w3AAAFACOG1M8x';

// Azure OpenAI 정보 설정
const AZURE_OPENAI_ENDPOINT = 'https://18419-m9qcjm6a-eastus2.cognitiveservices.azure.com/openai/deployments/keyword-cleaner/chat/completions?api-version=2025-01-01-preview';
const AZURE_OPENAI_KEY = 'A9GqumS7oOsmSNMpPjM5QaOCV6QzkMxCoQXRvOIxmDD8K99HQ2btJQQJ99BDACHYHv6XJ3w3AAAAACOGmXwm';

//임베딩 정보 설정
const EMBEDDING_ENDPOINT = 'https://18419-m9qcjm6a-eastus2.cognitiveservices.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2023-05-15';
const OPENAI_API_KEY = 'A9GqumS7oOsmSNMpPjM5QaOCV6QzkMxCoQXRvOIxmDD8K99HQ2btJQQJ99BDACHYHv6XJ3w3AAAAACOGmXwm';

//search AI 정보 설정
const SEARCH_ENDPOINT = 'https://<your-search-name>.search.windows.net';
const INDEX_NAME = '<your-index-name>';
const SEARCH_API_KEY = '<your-admin-key>';

async function callVisionAPI(imageUrl) {
  const response = await axios.post(
    VISION_ENDPOINT,
    { url: imageUrl },
    {
      headers: {
        'Ocp-Apim-Subscription-Key': VISION_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

async function callAzureOpenAI(tags, caption) {
  const prompt = {
    messages: [
      {
        role: 'system',
        content: '너는 키워드 정제기야. Vision API로부터 받은 태그와 설명을 바탕으로 쇼핑몰 검색에 사용할 수 있는 자연스러운 설명을 한 줄로 생성해줘.'
      },
      {
        role: 'user',
        content: `태그: ${tags.join(', ')}\n설명 문장: ${caption}`
      }
    ],
    temperature: 0.7,
    top_p: 1,
    max_tokens: 100
  };

  const maxRetries = 3; // 최대 재시도 3번
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await axios.post(
        AZURE_OPENAI_ENDPOINT,
        prompt,
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': AZURE_OPENAI_KEY
          }
        }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      attempt++;
      console.error(`❌ Azure AI 호출 실패 (시도 ${attempt}회):`, error.response?.data || error.message);

      if (attempt >= maxRetries) {
        throw error; // 3번 실패하면 진짜 에러 던짐
      }

      console.log('⏳ 잠시 대기 후 재시도합니다...');
      await new Promise(resolve => setTimeout(resolve, 4000)); // 4초 대기
    }
  }
}

async function callEmbeddingAPI(text) {

  const response = await axios.post(
    EMBEDDING_ENDPOINT,
    { input: text },
    {
      headers: {
        'Content-Type': 'application/json',
        'api-key': OPENAI_API_KEY
      }
    }
  );

  return response.data.data[0].embedding;
}

async function querySimilarItems(embeddingVector) {
  const response = await axios.post(
    `${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}/docs/search?api-version=2023-11-01`,
    {
      vector: {
        value: embeddingVector,
        fields: 'contentVector',
        k: 5
      },
      select: 'imageUrl'
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'api-key': SEARCH_API_KEY
      }
    }
  );
  return response.data.value;
}

app.post('/api/full-process', async (req, res) => {
  const imageUrl = req.body.imageUrl;

  try {
    const visionResult = await callVisionAPI(imageUrl);
    console.log(visionResult)

    const EXCLUDED_TAGS = ['person', 'man', 'woman', 'indoor', 'human', 'face', 'dressed', 'standing'];
    const tags = visionResult.tags
      .filter(tag => tag.confidence >= 0.7 && !EXCLUDED_TAGS.includes(tag.name))
      .map(tag => tag.name);
    const caption = visionResult.description.captions[0]?.text || '';


    const refinedText = await callAzureOpenAI(tags, caption);

    const embedding = await callEmbeddingAPI(refinedText);

    //const similarItems = await querySimilarItems(embedding);

    const similarItems = [
      { imageUrl: 'https://image.thehyundai.com/static/3/8/9/09/A2/hnm40A2099836_4_1600.jpg' },
      { imageUrl: 'https://image.thehyundai.com/static/2/6/2/07/A2/hnm40A2072625_6_1600.jpg' },
      { imageUrl: 'https://image.thehyundai.com/static/2/6/2/07/A2/hnm40A2072626_5_1600.jpg' },
      { imageUrl: 'https://image.thehyundai.com/static/2/2/8/07/A2/hnm40A2078228_6_1600.jpg' }
    ];

    res.json({
      vision: {
        tags: visionResult.tags?.map(tag => ({ name: tag.name })),
        caption: caption
      },
      refined: refinedText,
      embeddingText: embedding,
      similar: similarItems,
      originalImage: imageUrl
    });
   
  } catch (error) {    
    console.error('❌ 전체 처리 실패:', error.message);
    res.status(500).json({ error: '처리 실패', detail: error.message });
  }
});

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'build/index.html'));
});

app.listen(port, () => {
  console.log(`✅ 백엔드 실행 중`);
});