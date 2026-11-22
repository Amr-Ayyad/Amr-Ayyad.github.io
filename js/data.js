// ─────────────────────────────────────────────────────────────
//  محتوى السيرة الذاتية — عدّل النصوص هنا فقط
//  CV content — edit the text here only
//  كل نص له نسخة عربية (ar) ونسخة إنجليزية (en)
// ─────────────────────────────────────────────────────────────

export const CV = {
  name: { ar: 'عمرو هيثم أبو عياد', en: 'Amr Haitham Abu Ayyad' },
  short: { ar: 'عمرو أبو عياد', en: 'Amr Abu Ayyad' },
  role: { ar: 'محلل بيانات', en: 'Data Analyst' },
  lead: { ar: 'أحوّل البيانات إلى قرارات.', en: 'I turn data into decisions.' },
  email: 'amrooabuayyad@gmail.com',

  // نص النبذة: الكلمات بين نجمتين *هكذا* تظهر بلون مميز
  statement: {
    ar: 'أنا محلل بيانات، أحوّل الأرقام الخام إلى لوحات مؤشرات تصنع *قرارات* *واضحة.* حلّلت أكثر من *2.5* *مليون* *سجل* لجهات حكومية في قطاعَي العدل والنقل، وأدرس علم البيانات في مسار *الذكاء* *الاصطناعي.*',
    en: 'I’m a data analyst who turns raw numbers into dashboards that drive *clear* *decisions.* I’ve analyzed over *2.5M* *records* for government entities in justice and transport, and I’m studying Data Science on the *AI* *track.*',
  },

  stats: [
    { value: 2.5, decimals: 1, suffix: 'M+', label: { ar: 'سجل بيانات حلّلتها', en: 'records analyzed' }, featured: true },
    { value: 3, suffix: '+', label: { ar: 'لوحات مؤشرات لجهات حكومية', en: 'dashboards for government entities' } },
    { value: 2, label: { ar: 'جهتان حكوميتان', en: 'government entities' } },
    { value: 8, suffix: '+', label: { ar: 'دورات وشهادات احترافية', en: 'professional courses & certificates' } },
  ],

  experience: [
    {
      icon: 'scale', grad: ['#7cc4ff', '#2f6fb5'],
      title: { ar: 'محلل بيانات', en: 'Data Analyst' },
      org: { ar: 'مشاريع مركز التدريب العدلي — وزارة العدل', en: 'Judicial Training Center projects — Ministry of Justice' },
      period: '2025',
      points: {
        ar: [
          'حلّلت أكثر من 2.5 مليون سجل تدريبي لقياس كفاءة التدريب، وكشفت الفجوات والمشكلات المؤثرة فيه، وقدّمت حلولًا وخططًا لتحسينه.',
          'بنيت لوحة مؤشرات على Metabase مرتبطة آليًا بمنصة التذاكر، تقيس الفرق بين التذاكر المنجزة والمتأخرة وزمن المعالجة، وتصنّف الطلبات حسب النوع والأولوية.',
        ],
        en: [
          'Analyzed 2.5M+ training records to measure training effectiveness, uncover gaps and issues, and propose improvement plans.',
          'Built a Metabase dashboard connected live to the ticketing platform, tracking resolved vs. overdue tickets and resolution time, and classifying requests by type and priority.',
        ],
      },
    },
    {
      icon: 'trophy', grad: ['#7ef0ff', '#0b86ad'],
      title: { ar: 'محلل بيانات', en: 'Data Analyst' },
      org: { ar: 'جائزة وزارة النقل', en: 'Ministry of Transport Award' },
      period: '2025',
      points: {
        ar: [
          'صمّمت لوحة مؤشرات شاملة لمساهمات الرعاة ومواعيد السداد وتكاليف الموظفين والتدفقات النقدية (Cash In / Cash Out) والأرباح، لمتابعة الأداء المالي والتشغيلي.',
          'أعددت لوحة مؤشرات أداء رئيسية (KPIs) لمعالي وزير النقل لقياس المؤشرات الاستراتيجية للجائزة وتتبّعها.',
          'صنّفت مشاركات الجائزة وحلّلتها، مما سهّل عملية التقييم ورفع جودة التحكيم.',
          'ساهمت في مشروع «سند» بتحليل البيانات ودعم تحسين كفاءة العمليات.',
        ],
        en: [
          'Designed a dashboard covering sponsor contributions, payment schedules, staff costs, cash in/out and profit to monitor financial and operational performance.',
          'Built a KPI dashboard for H.E. the Minister of Transport to track the award’s strategic indicators.',
          'Classified and analyzed award submissions, streamlining evaluation and improving judging quality.',
          'Contributed to the “Sanad” project through data analysis that improved process efficiency.',
        ],
      },
    },
    {
      icon: 'code', grad: ['#b9e2ff', '#5b8fd6'],
      title: { ar: 'منتج محتوى ومطوّر مواقع', en: 'Content Producer & Web Developer' },
      org: { ar: 'عمل حر', en: 'Freelance' },
      period: '',
      points: {
        ar: [
          'أنتجت حالات تصويرية (أفلامًا تعليمية) لصالح مؤسسة تدريبية مرموقة، وبطاقات وصف محتوى لمقررات تدريبية.',
          'أنشأت موقعًا إلكترونيًا لشركة استشارية ومتجرًا إلكترونيًا لمؤسسة.',
          'غطّيت فعاليات ومؤتمرات ومعارض إعلاميًا بالتصوير.',
        ],
        en: [
          'Produced educational case-study films and course content cards for a leading training organization.',
          'Built a website for a consulting firm and an e-commerce store for an organization.',
          'Covered events, conferences and exhibitions as a photographer.',
        ],
      },
    },
  ],

  // الأدوات تظهر كأيقونات تطبيقات — dock = الشريط السفلي
  tools: [
    { icon: 'pie', grad: ['#8be9fb', '#1597c9'], label: { ar: 'تصوير البيانات', en: 'Data Viz' } },
    { icon: 'gauge', grad: ['#9be7ff', '#2b8fd6'], label: { ar: 'مؤشرات KPIs', en: 'KPIs' } },
    { icon: 'curve', grad: ['#ffc46b', '#ee8a12'], label: { ar: 'الإحصاء الوصفي', en: 'Statistics' } },
    { icon: 'neural', grad: ['#6ff0de', '#0f8f86'], label: { ar: 'تعلم الآلة', en: 'Machine Learning' } },
    { icon: 'chat', grad: ['#7be3a4', '#1f9d55'], label: { ar: 'التواصل', en: 'Communication' } },
    { icon: 'bulb', grad: ['#ffe17a', '#f0a018'], label: { ar: 'حل المشكلات', en: 'Problem Solving' } },
    { icon: 'team', grad: ['#8fd3ff', '#2563c9'], label: { ar: 'العمل الجماعي', en: 'Teamwork' } },
    { icon: 'clock', grad: ['#c9ced6', '#6b7280'], label: { ar: 'إدارة الوقت', en: 'Time Management' } },
  ],
  dock: [
    { icon: 'bars', grad: ['#ffd84d', '#f29b0c'], label: { ar: 'Power BI', en: 'Power BI' } },
    { icon: 'dash', grad: ['#8cc8ff', '#3474e0'], label: { ar: 'Metabase', en: 'Metabase' } },
    { icon: 'table', grad: ['#5fdc8f', '#178a4c'], label: { ar: 'Excel', en: 'Excel' } },
    { icon: 'db', grad: ['#a3a0ff', '#4f46e5'], label: { ar: 'قواعد البيانات', en: 'Databases' } },
  ],

  education: {
    degree: { ar: 'بكالوريوس علم البيانات', en: 'B.Sc. in Data Science' },
    track: { ar: 'مسار الذكاء الاصطناعي', en: 'Artificial Intelligence track' },
    school: { ar: 'الجامعة السعودية الإلكترونية', en: 'Saudi Electronic University' },
    year: '2025',
  },

  languages: [
    { name: { ar: 'العربية', en: 'Arabic' }, level: { ar: 'اللغة الأم', en: 'Native' } },
    { name: { ar: 'الإنجليزية', en: 'English' }, level: { ar: '', en: '' } },
  ],

  certs: [
    { icon: 'bars', grad: ['#ffd84d', '#f29b0c'], title: { ar: 'محترف Power BI', en: 'Power BI Professional' } },
    { icon: 'dash', grad: ['#8cc8ff', '#3474e0'], title: { ar: 'محترف Metabase', en: 'Metabase Professional' } },
    { icon: 'table', grad: ['#5fdc8f', '#178a4c'], title: { ar: 'تحليل البيانات باستخدام Excel', en: 'Data Analysis with Excel' } },
    { icon: 'neural', grad: ['#6ff0de', '#0f8f86'], title: { ar: 'علم البيانات وتعلم الآلة', en: 'Data Science & Machine Learning' } },
    { icon: 'curve', grad: ['#ffc46b', '#ee8a12'], title: { ar: 'مقدمة في تحليل البيانات والإحصاء الوصفي', en: 'Intro to Data Analysis & Descriptive Statistics' } },
    { icon: 'spark', grad: ['#a5f3fc', '#0891b2'], title: { ar: 'مقدمة في الذكاء الاصطناعي', en: 'Intro to Artificial Intelligence' } },
    { icon: 'shield', grad: ['#9be7ff', '#2b8fd6'], title: { ar: 'مقدمة في حوكمة الشركات', en: 'Intro to Corporate Governance' } },
    { icon: 'sigma', grad: ['#c9ced6', '#6b7280'], title: { ar: 'التحليل الإحصائي باستخدام SPSS', en: 'Statistical Analysis with SPSS' }, note: { ar: 'قيد الدراسة', en: 'In progress' } },
  ],

  // البطاقات التي تظهر حول الإنسان ثلاثي الأبعاد في الواجهة
  callouts: {
    // each label is also a link: "to" is the section it opens
    brain: { to: 'learn', t: { ar: 'ذكاء اصطناعي', en: 'Artificial Intelligence' }, s: { ar: 'دراستي وشهاداتي', en: 'Studies & certificates' } },
    rhand: { to: 'work', t: { ar: 'Power BI\u00a0· Metabase', en: 'Power BI\u00a0· Metabase' }, s: { ar: 'لوحات مؤشرات صمّمتها', en: 'Dashboards I built' } },
    lhand: { to: 'tools', t: { ar: 'Excel متقدم', en: 'Advanced Excel' }, s: { ar: 'أدواتي اليومية', en: 'My everyday toolkit' } },
    heart: { to: 'about', t: { ar: 'شغف وعمل جماعي', en: 'Passion & teamwork' }, s: { ar: 'نبذة عني', en: 'About me' } },
    base: { to: 'numbers', t: { ar: '2.5M+ سجل', en: '2.5M+ records' }, s: { ar: 'بيانات حلّلتها', en: 'analyzed' } },
  },
};

export const UI = {
  ar: {
    title: 'عمرو أبو عياد | محلل بيانات',
    hello: 'مرحبًا، أنا',
    ctaContact: 'تواصل معي',
    ctaWork: 'استعرض أعمالي',
    skip: 'تخطَّ المقدمة',
    scroll: 'مرّر للأسفل',
    init: 'تهيئة الشبكة العصبية',
    initShort: 'جارٍ التهيئة',
    available: 'متاح لفرص العمل',
    availableShort: 'متاح للعمل',
    copied: 'تم نسخ البريد',
    numbersEyebrow: 'بالأرقام',
    numbersTitle: 'أرقام تتحدث عن نفسها.',
    workEyebrow: 'الخبرات',
    workTitle: 'أعمال صنعت فرقًا.',
    toolsEyebrow: 'الأدوات والمهارات',
    toolsTitle: 'أدواتي اليومية.',
    toolsText: 'من تنظيف البيانات الخام إلى لوحة المؤشرات النهائية، هذه الأدوات والمهارات التي أعتمد عليها كل يوم.',
    learnEyebrow: 'التعليم',
    learnTitle: 'تعلّم لا يتوقف.',
    edu: 'التعليم',
    langs: 'اللغات',
    certs: 'الشهادات والدورات',
    graduation: 'سنة التخرج',
    contactEyebrow: 'تواصل',
    contactTitle: 'لنحوّل بياناتك إلى قرارات.',
    contactText: 'متاح لفرص العمل والمشاريع في تحليل البيانات ولوحات المؤشرات.',
    mail: 'راسلني عبر البريد',
    copy: 'نسخ البريد',
    pdf: 'حفظ كملف PDF',
    sections: 'أقسام الصفحة',
    nav: { home: 'الرئيسية', about: 'نبذة', numbers: 'بالأرقام', work: 'الخبرات', tools: 'الأدوات', learn: 'التعليم', contact: 'تواصل' },
    langLabel: 'English',
    themeLabel: 'الوضع الداكن',
    menu: 'القائمة',
    rights: 'جميع الحقوق محفوظة',
    description: 'عمرو أبو عياد، محلل بيانات. لوحات مؤشرات وتحليل بيانات لجهات حكومية في قطاعَي العدل والنقل.',
  },
  en: {
    title: 'Amr Abu Ayyad | Data Analyst',
    hello: 'Hi, I’m',
    ctaContact: 'Get in touch',
    ctaWork: 'See my work',
    skip: 'Skip intro',
    scroll: 'Scroll',
    init: 'Initializing neural network',
    initShort: 'Initializing',
    available: 'Open to opportunities',
    availableShort: 'Open to work',
    copied: 'Email copied',
    numbersEyebrow: 'By the numbers',
    numbersTitle: 'Numbers that speak.',
    workEyebrow: 'Experience',
    workTitle: 'Work that made a difference.',
    toolsEyebrow: 'Tools & skills',
    toolsTitle: 'My everyday toolkit.',
    toolsText: 'From cleaning raw data to the final dashboard, these are the tools and skills I rely on every day.',
    learnEyebrow: 'Education',
    learnTitle: 'Always learning.',
    edu: 'Education',
    langs: 'Languages',
    certs: 'Certificates & courses',
    graduation: 'Graduation',
    contactEyebrow: 'Contact',
    contactTitle: 'Let’s turn your data into decisions.',
    contactText: 'Open to roles and projects in data analysis and dashboards.',
    mail: 'Email me',
    copy: 'Copy email',
    pdf: 'Save as PDF',
    sections: 'Page sections',
    nav: { home: 'Home', about: 'About', numbers: 'Numbers', work: 'Experience', tools: 'Toolkit', learn: 'Education', contact: 'Contact' },
    langLabel: 'العربية',
    themeLabel: 'Dark mode',
    menu: 'Menu',
    rights: 'All rights reserved',
    description: 'Amr Abu Ayyad, Data Analyst. Dashboards and data analysis for government entities in justice and transport.',
  },
};
