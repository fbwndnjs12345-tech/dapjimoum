// Major Korean Publishers
const ALL_PUBLISHERS = [
  "전체", "좋은책신사고", "비상교육", "수경출판사", "마더텅", 
  "미래엔", "천재교육", "메가스터디북스", "디딤돌", "동아출판", 
  "지학사", "EBS", "이투스북", "꿈틀", "개념원리"
];

const ALL_SUBJECTS = ["전체", "국어", "수학", "영어", "과학", "사회", "한국사"];
const ALL_GRADES = ["전체", "초등", "중1", "중2", "중3", "고1", "고2", "고3"];
const ALL_SEMESTERS = ["전체", "1학기", "2학기", "공통"];

// Rich initial dataset for Korean workbooks
const INITIAL_BOOKS = [
  {
    id: "b1a2c3d4-0001",
    title: "쎈 중등 수학 1-1",
    publisher: "좋은책신사고",
    subject: "수학",
    grade: "중1",
    semester: "1학기",
    series: "쎈 시리즈",
    thumbnail_url: "https://images.unsplash.com/photo-1632571401005-458e9d244591?w=400&auto=format&fit=crop&q=80",
    description: "전국 중학교 시험 기출 문제를 유형별로 완벽 분석하여 수록한 대표 수학 문제집",
    created_at: "2026-01-10T09:00:00Z"
  },
  {
    id: "b1a2c3d4-0002",
    title: "개념쎈 고등 수학 (상)",
    publisher: "좋은책신사고",
    subject: "수학",
    grade: "고1",
    semester: "1학기",
    series: "개념쎈",
    thumbnail_url: "https://images.unsplash.com/photo-1509228468518-180dd4864904?w=400&auto=format&fit=crop&q=80",
    description: "개념을 한눈에 시각적으로 파악하고 체계적으로 학습할 수 있는 고등 수학 기본서",
    created_at: "2026-01-15T11:20:00Z"
  },
  {
    id: "b1a2c3d4-0003",
    title: "자이스토리 고등 영어 독해 기본",
    publisher: "수경출판사",
    subject: "영어",
    grade: "고1",
    semester: "공통",
    series: "자이스토리",
    thumbnail_url: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&auto=format&fit=crop&q=80",
    description: "수능 및 모의고사 기출 지문을 유형별로 철저히 분석하고 체계적인 해설을 제공하는 독해서",
    created_at: "2026-02-01T14:30:00Z"
  },
  {
    id: "b1a2c3d4-0004",
    title: "완자 중등 과학 2",
    publisher: "비상교육",
    subject: "과학",
    grade: "중2",
    semester: "공통",
    series: "완자",
    thumbnail_url: "https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=400&auto=format&fit=crop&q=80",
    description: "자율 학습에 최적화된 명쾌한 개념 정리와 친절한 문제 해설이 담긴 중등 과학 교재",
    created_at: "2026-02-10T10:15:00Z"
  },
  {
    id: "b1a2c3d4-0005",
    title: "마더텅 수능기출문제집 국어 문학",
    publisher: "마더텅",
    subject: "국어",
    grade: "고3",
    semester: "공통",
    series: "마더텅 까만책",
    thumbnail_url: "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=400&auto=format&fit=crop&q=80",
    description: "최신 수능 및 평가원 기출문제를 올컬러 해설과 문제풀이 팁으로 완전 정복",
    created_at: "2026-02-20T16:00:00Z"
  },
  {
    id: "b1a2c3d4-0006",
    title: "오투 중등 과학 3-1",
    publisher: "비상교육",
    subject: "과학",
    grade: "중3",
    semester: "1학기",
    series: "오투",
    thumbnail_url: "https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=400&auto=format&fit=crop&q=80",
    description: "생생한 사진과 그림 탐구 자료로 교과서 핵심 개념을 확실하게 잡는 탐구 중심 과학서",
    created_at: "2026-03-01T08:45:00Z"
  },
  {
    id: "b1a2c3d4-0007",
    title: "EBS 수능특강 수학I (2027학년도)",
    publisher: "EBS",
    subject: "수학",
    grade: "고3",
    semester: "공통",
    series: "수능특강",
    thumbnail_url: "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=400&auto=format&fit=crop&q=80",
    description: "수능 연계교재 1위, 수능 필수 유형 분석 및 실전 연습 문제 수록",
    created_at: "2026-03-02T09:00:00Z"
  },
  {
    id: "b1a2c3d4-0008",
    title: "개념원리 고등 수학 1",
    publisher: "개념원리",
    subject: "수학",
    grade: "고2",
    semester: "1학기",
    series: "개념원리",
    thumbnail_url: "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400&auto=format&fit=crop&q=80",
    description: "수학의 기본 개념을 체계적이고 확실하게 세워주는 필수 정석 개념서",
    created_at: "2026-03-03T11:10:00Z"
  },
  {
    id: "b1a2c3d4-0009",
    title: "블랙라벨 중학 수학 2-1",
    publisher: "진학사",
    subject: "수학",
    grade: "중2",
    semester: "1학기",
    series: "블랙라벨",
    thumbnail_url: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&auto=format&fit=crop&q=80",
    description: "상위권 도약을 위한 심화 정복 문제집, 변별력 높은 고난도 기출 문제 구성",
    created_at: "2026-03-04T13:40:00Z"
  },
  {
    id: "b1a2c3d4-0010",
    title: "1등급 만들기 고등 한국사",
    publisher: "미래엔",
    subject: "한국사",
    grade: "고1",
    semester: "공통",
    series: "1등급 만들기",
    thumbnail_url: "https://images.unsplash.com/photo-1461360370896-922624d12aa1?w=400&auto=format&fit=crop&q=80",
    description: "시험에 꼭 나오는 핵심 개념 정리와 내신 1등급 완성 기출 문제집",
    created_at: "2026-03-05T15:20:00Z"
  }
];

// Initial dataset for external answer links
const INITIAL_LINKS = [
  {
    id: "l1a2c3d4-0001",
    book_id: "b1a2c3d4-0001",
    title: "정답과 해설 (전체 PDF)",
    url: "https://www.sinsago.co.kr/book/book_view.ch?book_idx=1023",
    source_name: "좋은책신사고 공식몰",
    link_type: "해설지",
    verified: true,
    last_checked_at: "2026-03-05T12:00:00Z",
    click_count: 2420
  },
  {
    id: "l1a2c3d4-0002",
    book_id: "b1a2c3d4-0001",
    title: "빠른 정답 채점표",
    url: "https://www.sinsago.co.kr/download/fast_answer.pdf",
    source_name: "신사고 자료실",
    link_type: "빠른정답",
    verified: true,
    last_checked_at: "2026-03-05T12:00:00Z",
    click_count: 1256
  },
  {
    id: "l1a2c3d4-0003",
    book_id: "b1a2c3d4-0002",
    title: "개념쎈 고등 수학(상) 정답해설 PDF",
    url: "https://www.sinsago.co.kr/high/math/view.asp?id=442",
    source_name: "좋은책신사고 공식몰",
    link_type: "해설지",
    verified: true,
    last_checked_at: "2026-03-04T10:30:00Z",
    click_count: 1930
  },
  {
    id: "l1a2c3d4-0004",
    book_id: "b1a2c3d4-0003",
    title: "자이스토리 영어 독해 정답지",
    url: "http://www.booksoopyung.com/download/answer_link?id=8831",
    source_name: "수경출판사 자료실",
    link_type: "해설지",
    verified: false,
    last_checked_at: "2026-02-28T09:15:00Z",
    click_count: 812
  },
  {
    id: "l1a2c3d4-0005",
    book_id: "b1a2c3d4-0004",
    title: "완자 중등 과학 2 정답 및 해설",
    url: "https://www.visang.com/book/detail?bookSeq=50122",
    source_name: "비상교재 브랜드몰",
    link_type: "해설지",
    verified: true,
    last_checked_at: "2026-03-01T15:20:00Z",
    click_count: 1640
  },
  {
    id: "l1a2c3d4-0006",
    book_id: "b1a2c3d4-0005",
    title: "마더텅 국어 문학 정오표 및 해설지",
    url: "https://www.toptutor.co.kr/board/view.jsp?id=992",
    source_name: "마더텅 자료실",
    link_type: "해설지",
    verified: true,
    last_checked_at: "2026-03-02T11:00:00Z",
    click_count: 3120
  },
  {
    id: "l1a2c3d4-0007",
    book_id: "b1a2c3d4-0007",
    title: "2027 수능특강 수학I 정답과 해설",
    url: "https://www.ebsi.co.kr/ebs/pot/potg/retrieveBookDataDetail.ebs",
    source_name: "EBSi 교재 자료실",
    link_type: "해설지",
    verified: true,
    last_checked_at: "2026-03-06T08:00:00Z",
    click_count: 4890
  },
  {
    id: "l1a2c3d4-0008",
    book_id: "b1a2c3d4-0008",
    title: "개념원리 수학1 답지 PDF 다운로드",
    url: "https://www.imath.tv/book/solution/102",
    source_name: "개념원리 공식 웹",
    link_type: "해설지",
    verified: true,
    last_checked_at: "2026-03-04T12:00:00Z",
    click_count: 2210
  }
];


export { ALL_PUBLISHERS, ALL_SUBJECTS, ALL_GRADES, ALL_SEMESTERS, INITIAL_BOOKS, INITIAL_LINKS };
