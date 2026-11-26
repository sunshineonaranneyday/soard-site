/**
 * Given names people really go by, for the Advisory Board greeting (_advisory-form.js greetName, round 20, Nov 21 2026).
 * A greeting greets a word only when it's on this list: positive evidence, never "nothing said it isn't a name" (rounds
 * 15 to 20 each found words greeted that weren't names). Written by hand for the people who live around Atlanta and
 * apply to boards here: American and English, African American, Hispanic and Latino, Caribbean, West and East African,
 * South Asian, East and Southeast Asian (usual romanized forms), Arabic, Persian and Turkish, Hebrew, and European given
 * names, and common nicknames. Each in its usual capitals (TJ, DeShawn, LaToya, McKenzie, D'Andre, Mary-Kate): a name
 * typed all in capitals or all in small letters is greeted in these.
 *
 * Left out on purpose (when in doubt, left out): words that are mostly a title, an office or a rank (Dean, Judge,
 * Bishop, Deacon, Major, Prince, King, Duke, Don, Nana, Obi, Sultan), family words (Junior, Bubba, Nan, Mimi, Gigi),
 * business words, places in Georgia (Georgia, Savannah, Augusta, Macon, Marietta, Dallas, Houston), and everyday
 * English words that are rarely a name (Love, Peace, Price, Royal, River, Story, Heaven, Diamond, Lucky, Rich, May).
 * Two capitals that are letters or a job as often as a name are out too (JR, JD, JP, DJ, BJ).
 *
 * FAMILY_FIRST: family names that come first (Vietnamese, Chinese, Korean, Hmong and the like). A full name whose first
 * word is one of these is greeted by no name, even when the word is a given name too ("Kim Min-jun", "Lee Ji-eun").
 *
 * Server only in practice: the application page imports _advisory-form.js, and so this file, but never greets anyone, so
 * its bundle leaves all of this out. That holds only while nothing here runs when the file loads: every list is a plain
 * string, split when a greeting first asks (build). Round 21: NEVER was split as the file loaded, so it shipped in the
 * page's bundle (about 1 KB); now it's a plain string like the rest, and the bundle has none of these lists (checked by
 * building: not a word of them in the apply page's script).
 *
 * Round 21 (Nov 22 2026) also marks, from the lists above: women's names and names both go by (for a greeting after a
 * woman's courtesy title), family names that come first only before their own people's given names (Sam, Joe), Hungary's
 * given names (a name ending in one is written family name first), and given names that are titles before a whole name
 * (Malik, Earl) or the first word of a title of two (Ida Bagus). East and Southeast Asian names are each people's own list.
 *
 * Round 22 (Nov 22 2026): Hungary's given names written out (about three hundred), and every given name here that's a
 * family name too where family names come first marked with its people (FAMILY_FIRST_BEFORE), not only Sam and Joe.
 */

// East and Southeast Asian given names, as usually romanized, each people's own (one list until round 21)
const CHINESE = `Mei Ming Jing Ying Jie Xin Hui Ling Hua Qing Xiaoming Xiaoyan Jian Jun Hao Bo Ping Lei Tao Fei Lan Na Yan Yun
Zhen Zhiwei Xiaoling Lili Rui Wen Wenjun Yiming Zihan Yuxuan Haoran Zixuan Yutong Xinyi Jiayi Yixuan Siyu Ruoxi Shu Shan Qi
Jia Kai Yong Bin Chao Feng Gang Jiang Kang Liang Ning Peng Qiang Wei Xiang Yi Yu Zhi Hong Meiling Meihua Xiaohong
Xiaomei Xiaowei Jingyi Yiting Yuting Shuang Ying-Ying Chia-Hao Chih-Ming Hsin-Yi Yu-Ting Wei-Ming Pei-Shan Shu-Fen
Jianguo Jianhua Jianjun Jianping Jianming Jianxin Jianwei Jianbo Jianfeng Jianlin Jianzhong Jianyu Zhiqiang Zhiming Zhihua
Zhigang Zhiyong Zhijun Zhihao Zhiyuan Zhixin Zhiyu Zhihong Zhihui Zhiling Guoqiang Guohua Guoliang Guoping Guoqing Guodong
Guozhong Guowei Guoxiang Weidong Weiguo Weimin Weiping Weixing Weijie Weihua Weilin Weijun Weiqiang Haitao Haibo Haiyang
Haifeng Haiming Hailong Haijun Haiqing Haiyan Haiying Haoyu Haoming Haoyang Haoxuan Haoze Hongwei Hongbo Hongjun Honglin
Hongtao Hongyu Hongliang Hongmei Hongxia Hongyan Hongying Junjie Junhao Junwei Junfeng Junming Junyi Junxi Mingyu Minghui
Mingzhe Mingjie Mingxuan Mingyang Mingze Xiaojun Xiaolong Xiaodong Xiaogang Xiaobo Xiaoyu Xiaofeng Xiaopeng Xiaotian
Xiaohu Xiaoli Xiaojuan Xiaoqing Xiaoxia Xiaofang Xiaohui Xiaoyun Xiaolin Xiaoqin Xiaodan Xiaojing Xiaoting Xiaowen Xiaoxue
Yifan Yichen Yuhang Yuchen Yuze Yuxin Yuhao Yuming Yuqi Yuhan Yuyan Yuwen Yuling Yufei Yujie Yumei Yuying Yuhua Yulan
Yuzhen Yuliang Zihao Ziyi Zirui Ziming Zixin Zitong Ziyan Ziqi Zhenyu Zhenhua Zhenguo Zhenhai Zhengyang Zexi Zeyu Zelin
Ruiqi Ruichen Ruize Ruixue Wenbo Wenhao Wenjie Wenxuan Wenqiang Wenhua Wenli Wenming Wentao Wenzhe Wenjing Wenwen Wenting
Wenya Wenqian Wenxin Xiangyu Xiangdong Xuanyu Yanbin Yanjun Yanlin Yanming Yanpeng Yanyan Yanling Yanhong Yanmei Yanping
Yanqiu Yinan Yixin Yiqi Yiwen Yongjun Yongqiang Yonghui Yongming Yongsheng Yongping Yonghua Lijun Liming Liwei Lixin Lihong
Libin Lifeng Lihua Lijuan Liping Lixia Liying Lifang Limei Liqin Liyan Shengli Shenglin Shiyu Shijie Shiqi Shiming
Shuguang Songtao Tianyu Tianyi Tianhao Tianle Tianming Xinyu Xinhua Xingyu Xinyue Xinran Xinxin Xudong Xuefeng Xueming
Xueli Xuemei Xueying Xueqin Yaoming Jiahao Jiaming Jiaqi Jiarui Jiawei Jiayu Jiajun Jialong Jiahui Jiaxin Jiaying Jingwei
Jinghua Jingwen Jingyu Jingjing Jinhai Jinlong Jinming Jintao Jinhua Kaiyuan Kaiwen Qiming Qingyu Qinghua Qingsong
Rongguo Ronghua Shaohua Shaojie Xiuying Xiulan Xiuzhen Xiumei Xiuhua Guiying Guilan Guifang Guizhen Dongmei Chunhua
Chunmei Chunyan Chunxia Chunling Chunlan Meili Meilin Meiqi Meiying Yaqi Yating Yawen Yaxin Yafei Yali Yingying Yuexin
Shanshan Shuhua Shuqin Shuzhen Shuting Shuyi Siqi Sitong Simin Ruolan Ruyi Qianqian Qiong Qiuju Qiuxia Mengyao Mengqi
Mengting Mengmeng Lingling Lingyun Lanying Juanjuan Huimin Huifang Huiling Huiqin Huizhen Huiying Huijuan Fangfang
Fengying Feifei Dandan Cuiping Cuihua Chenxi Bingbing Baoyu Aiping Aihua Aiying Zhenzhen Yuanyuan Yunfei Yunhua Yunfeng
Yunlong Yunpeng Yuntao Tingting Zhaohui Zhonghua Zhongwei Xinyang Xuyang Zhuo Shuo Shuai Bowen
Mei-ling Chun-hui Ya-ting Chia-hui Shu-hui Hui-ling Chien-hung Tsung-han Kuan-yu Yi-chen Po-han Wen-hsiung Chun-chieh
Hsiao-mei Yu-chen Yu-hsuan Chih-hao Chia-ling Chia-wei Chih-wei Chun-ming Hsin-hui Hsiu-ying Hsiu-lan Hui-chen Hui-chun
Hui-wen Kai-wen Li-hua Li-ling Mei-hua Mei-hui Pei-yu Pei-ling Shih-chieh Shu-chen Shu-ling Shu-ping Shu-yi Ting-ting
Tzu-yu Tzu-hsuan Wan-ting Wei-chen Wei-lun Wen-chieh Wen-ling Ya-chi Ya-hui Ya-wen Yi-hsuan Yi-ling Yi-ting Yi-wen Yu-han
Yu-hsin Yu-chieh Yu-ling Chien-ming Chih-hung Chin-lung Ching-wen Chun-kai Hsiang-yu Kuo-hua Kuo-liang Ming-hui Ming-che
Po-yu Shao-wei Tsung-yu Wei-hsiang Wei-ting Yao-ting Yen-ting Yu-chun Yu-sheng Cheng-han Cheng-yu Chia-jung Hsin-yu
Tzu-han Ka-ming Wing-yan Siu-ming Chi-wai Ka-yan Wai-man Kin-wah Man-kit Hoi-yan Chun-kit Siu-wai Ka-wai Ka-man Ka-ho
Ka-yee Wai-yin Wai-ling Wai-kit Wing-kin Wing-sze Mei-yee Mei-kuen Suk-yee Suk-ching Siu-fong Kwok-wai Kwok-keung
Chi-keung Chi-ming Chun-wai Hoi-ming Hon-ming Kin-man Man-yee Man-wai Pui-yee Pui-ling Sau-ling Sze-wing Tsz-yan
Tsz-ching Tsz-hin Yuk-ling Yuk-lan Yee-man Hiu-yan Hiu-tung Ho-yin Lok-yi`;
const JAPANESE = `Akira Aiko Akiko Ayaka Ayumi Chiaki Chiyo Daichi Daiki Emi Eri Fumiko Hana Hanako Haruka Haruki Haruto Hideki
Hideo Hikari Hina Hiro Hiroko Hiroshi Hiroto Hitomi Ichiro Junko Kaito Kana Kaori Kazuki Kazuo Keiko Kenji Kenta Kenzo
Kiyoshi Koji Kumiko Mai Makoto Mami Mari Mariko Masako Masao Masato Mayumi Megumi Michiko Midori Miho Miki Minoru Misaki
Miyu Naoki Naoko Naomi Natsuki Noriko Osamu Reiko Ren Riku Rin Rina Ryo Ryota Sachiko Sakura Satoshi Shigeru Shinji
Shiori Shota Sora Sota Takashi Takumi Takeshi Taro Tetsuya Tomoko Toshiro Yoko Yoshi Yoshiko Yoshiro Yui Yuka Yuki
Yukiko Yumi Yuna Yusuke Yuto Kei Kenichi Shunsuke Seiji Tatsuya Hayato Asuka Aoi Nanami`;
const KOREAN = `Min-jun Seo-yeon Ji-hoon Ji-woo Hyun-woo Jae-won Sung-min Ji-eun Soo-jin Eun-ji Min-ji Ha-eun Yeon-woo Jun-ho
Dong-hyun Hye-jin Ji-young Joon-ho Min-seo Seo-jun Do-yoon Ye-jin Soo-ah Hyun-jin Jae-hyun Sang-woo Young-ho Mi-kyung
Kyung-soo Joon Jae Seung Hyun Sang Min Eun Soo Jin Ji Hye Sun Yeon Jun Young-mi Myung Chul Jiho Jisoo Jiwoo Minji Seojin
Yuna Sung-ho Young-soo Jung-hee Eun-young Min-soo Hye-won Dong-hoon Jae-hoon Ji-min Ji-yeon Hye-jung Mi-young Sun-hee
Jung-ho Seung-hoon Seung-woo Sung-hoon Young-jae Eun-jung Hyun-jung Soo-min Ji-hyun Kyung-hee Jae-min Hae-won`;
const VIETNAMESE = `An Anh Bao Binh Chau Chi Cuong Dung Duc Duy Giang Hai Hanh Hieu Hoa Hung Huong Huy Khanh Khoa Kim Lan Linh
Loan Minh Ngoc Nhung Phuong Phuc Quang Quoc Quynh Tam Thanh Thao Thu Thuy Tien Trang Trung Tuan Tung Uyen Viet Vy Xuan
Yen Bich Diep Hang Hien Hong Khoi Lien Long Mai My Nga Nhi Oanh Phong Sang Tai Thi Thien Tho Thuan Toan Trinh Truc Tu Vinh
Nam`;
const FILIPINO = `Rizalino Jomar Arnel Rowena Marites Maricel Lorna Analyn Rhea Jhun Rodel Romeo Reynaldo Rommel Ernesto Danilo
Edgardo Lourdes Imelda Corazon Teresita Rosalinda Marilou Josefina Erlinda Leonora Nenita Lolita Charmaine Mylene Jasmin
Joanne Jocelyn Liezl Kristine Ma Rina Ruel Ariel Benjie Ronnie Jojo`;
const THAI = `Somchai Anong Malee Niran Pim Ploy Somsak Suda Kanya Arthit Chai Kulap Mali Nok Prasert Sombat Sunee Thida Wichai`;
const INDONESIAN = `Agus Budi Dewi Putri Wayan Komang Ketut Nyoman Ayu Bambang Joko Rudi Siti Wati Yanti Indah Rina Ratna Lestari
Dian`;
const HMONG = `Kou Pao Yer Chue Tou Nou Xee Kia Neng Shoua Chong Txawj Pa Houa Yeng Maiyer Maikou`;
const BURMESE = `Aung Htet Kyaw Myint Thandar Thura Zaw Phyo`;
// (Cambodian: round 21 added the ones after Phalla, "Sam Rainsy" being Rainsy of the Sam family)
const KHMER = `Sokha Sophea Dara Chantha Vanna Bopha Sovann Rithy Phalla Rainsy Sokhom Vibol Sophal Sopheap Kosal Visal Pisey
Channary Chenda Sothea Rotha Kunthea Sokunthea Sreymom Vuthy Sambath Narith Vannak Piseth Rathana Bunthoeun Chanthou
Leakhena Sreyleak Sophorn Sopheak Samnang Sreypov Bunna Sothy Vanny Chamroeun Sovanna Sreyneang Sreymao Socheata Sophy
Sopheaktra Rotanak Sovannara Veasna Vutha Chanthy Kanha Bunthan Sokhorn Pheap Sreyroth Chanra Seyha Pisith Virak Sarath
Sarun Sokun Vichea Ratha Rattana Sreynich Malis Kunthy Phearom Phearith Visoth Theary Mealea Sokchea Sovanny Sreynuon
Kanika Vannary Raksmey Dalin Chanthol Chantrea Davuth Kimsour Leakena Monyrath Nimol Phally Samedy Seila Sereyvuth Serey
Sokleng Somaly Sophanna Sophat Sopheara Sotheara Sovath Thearith Vicheka Vireak Borey Chakriya Channa Kolab Mony Nary
Pheakdey Phirun Puthy Ratanak Sakada Sokhem Sokny Sopha Sothun Vichet Ponleu Bunly Sreyka Sreymey Kimly Kimleng
Panha Vannara Sophearith Lyhour Chivorn Sitha Monirath Moniroth Phearun Theavy Sreynoch Sreyneath Navy Raksa Ravy Sopheakdey
Lida Chhorvy Kimheng Bona Sokhoeun Davy Rachana Rachna Dalis Dany Davin Kakada Kalyan Kolap Lyna Makara Malai Mealtey Monika
Monineath Monivong Narin Phanith Phanna Phearum Phoeurn Rasmey Reaksmey Rathanak Rattanak Sambo Samoeun Sarin Savuth
Sinath Socheat Sochea Sokleap Sokly Somnang Sovan Sovannarith Sovannary Sovathana Sovichea Sreyoun Sreymach Sreypich
Sreyly Sreyna Sreytouch Tevy Thavy Thavrin Tola Bunthorn Bunleng Bunheng Bunrith Chamnan Chanvatey Dararith Daravuth
Kanitha Kimchheng Kimsan Kimhong Kimlang Kimsreang Leap Malika Manith Mardy Nita Phirum Phoung Pisal Rotana Sakal Sakhorn
Samphors Sareth Sarorn Saroeun Sarom Savoeun Sereysothea Sinoun Sithy Sivlin Soben Sokchenda Sokhen Sokhoeurn Sophanith
Sophoan Sothearith Sotheavy Sovanara Srun Sunly Tharith Thona Vannarith Vathana Vichheka Visna Vongsa Vuthea Chhaya
Bopharath Borin Botum Chanmony Chanrith Chanthorn Chanvanna Chhunly Darong Ladin Leakhana Kosoma Limhour Lyheng Meyling
Mengly Monyroth Narong Neary Nimith Oudom Pharith Phanit Phally Pheara Pheaktra Pisith Pisach Ponlok Rany Rathvisal Rithya
Rotha Sakhoeun Samath Sambath Samrith  Saran Sarath Sareoun Seakly Seila Senghong Sethy Sitheng Sivmey Sokim Sokna
Sokpheak Sombo Sopheaktra Sophoeun Soriya Sothavy Sotheary Sovanndy Sreyneth Sreynuch Sreypheap Sreysor Sreyvy Sungha
Thearath Theara Thoeun Thyda Thyrith Udom Vanndy Vannith Veasna Vichika Vimean Vireakboth Visothy Vitou Vouchny`;
const LAO = `Khamphet Somphone`;

// American and English, women (named: round 21's women's list reads it whole)
const ENGLISH_WOMEN = `Abigail Abby Abbie Ada Adaline Adalyn Adalynn Addie Addilyn Addison Adelaide Adele Adelina Adeline Adelyn Adrianna
  Adrienne Agatha Agnes Aileen Ainsley Alaina Alana Alanna Alayna Alberta Alexa Alexandra Alexandria Alexia Alexis Ali
  Alice Alicia Alina Alisha Alison Alissa Aliyah Allie Allison Ally Allyson Alma Alyson Alyssa Amanda Amaya Amber Amelia
  Amelie Amy Anastasia Andrea Angela Angelia Angelica Angelina Angeline Angie Anita Ann Anna Annabel Annabella Annabelle
  Annalise Anne Annette Annie Annika Antoinette April Arabella Aria Ariana Arianna Ariel Ariella Arielle Arlene Ashlee
  Ashleigh Ashley Ashlyn Ashlynn Athena Aubree Aubrey Aubrie Audra Audrey Audrina Aurora Autumn Ava Avery Ayla Bailey
  Barbara Beatrice Becky Belinda Bella Belle Bernadette Bernice Bertha Beryl Bess Bessie Beth Bethany Betsy Bette Bettie
  Betty Beulah Beverly Bianca Billie Blair Blanche Bobbie Bonita Bonnie Brandi Brandie Brandy Brenda Brenna Briana
  Brianna Brianne Bridget Bridgette Brielle Britney Britni Britt Brittany Brittney Brooke Brooklyn Brooklynn Brynn
  Caitlin Caitlyn Callie Cameron Camila Camilla Camille Camryn Candace Candice Cara Carissa Carla Carley Carlie Carly
  Carmen Carol Carole Caroline Carolyn Carrie Casey Cassandra Cassidy Cassie Catherine Cathy Cecelia Cecilia Celeste
  Celia Celine Chandra Charity Charlene Charlotte Chelsea Chelsey Cheri Cherie Cheryl Cheyenne Chloe Chrissy Christa
  Christen Christi Christie Christina Christine Christy Ciara Cindy Claire Clara Clarice Clarissa Claudia Colleen
  Connie Constance Cora Coraline Cordelia Corinne Cornelia Courtney Crystal Cynthia Daisy Dakota Dana Daniela Daniella
  Danielle Daphne Darcy Darla Darlene Dawn Deanna Deanne Debbie Deborah Debra Deirdre Delaney Delia Delilah Della Delores
  Denise Desiree Destiny Diana Diane Dianna Dianne Dixie Dolly Dolores Dominique Donna Dora Doreen Doris Dorothea Dorothy
  Edith Edna Eileen Elaina Elaine Eleanor Eleanora Elena Eliana Elisa Elisabeth Elise Eliza Elizabeth Ella Ellen Ellie
  Elliana Ellianna Eloise Elsa Elsie Emerson Emery Emilia Emily Emma Emmalyn Emmy Erica Erika Erin Esme Estella Estelle
  Esther Ethel Etta Eugenia Eunice Eva Evangeline Eve Evelyn Everly Evie Faith Fannie Faye Felicia Felicity Fiona
  Flora Florence Frances Francesca Francine Frankie Freda Freya Gabriela Gabriella Gabrielle Gail Gayle Gemma Genevieve
  Georgette Georgina Geraldine Gianna Gillian Gina Ginger Ginny Giselle Gladys Glenda Gloria Goldie Grace Gracelyn
  Gracie Greta Gretchen Gwen Gwendolyn Hadley Hailey Haley Hallie Hannah Harley Harper Harriet Hattie Hayden Haylee Hayley
  Hazel Heather Heidi Helen Helena Henrietta Hilary Hillary Holly Hope Ida Imogen Ingrid Irene Iris Irma Isabel
  Isabella Isabelle Isla Ivy Jackie Jaclyn Jacqueline Jacquelyn Jade Jaime Jamie Jan Jana Jane Janelle Janet Janice
  Janie Janine Janis Jasmine Jayla Jayne Jean Jeanette Jeanie Jeanine Jeanne Jeannie Jenna Jennie Jennifer Jenny Jessa
  Jessica Jessie Jill Jillian Jo Joan Joann JoAnn Joanna Joanne Jocelyn Jodi Jodie Jody Johanna Jolene Jordyn Josephine
  Josie Joy Joyce Judith Judy Julia Juliana Julianna Julianne Julie Juliet Juliette June Justine Kaitlin Kaitlyn Kara
  Karen Kari Karin Karina Karla Karlee Kassandra Kate Katelyn Katelynn Katharine Katherine Kathleen Kathryn Kathy Katie
  Katrina Katy Kay Kaya Kayla Kaylee Kayleigh Keira Kelley Kelli Kellie Kelly Kelsey Kelsie Kendall Kendra Kenzie Kerri
  Kerry Kim Kimberley Kimberly Kinley Kinsley Kira Kirsten Krista Kristen Kristi Kristie Kristin Kristina Kristine
  Kristy Krystal Kylee Kylie Lacey Laila Lainey Lana Lara Laura Laurel Lauren Laurie Layla Lea Leah Leann Leanne Leigh
  Leila Lena Leona Leslie Lexi Lila Lilah Liliana Lillian Lilly Lily Lindsay Lindsey Linnea Lisa Liza Lizzie Lois Lola
  Lora Loretta Lori Lorna Lorraine Lottie Louisa Louise Luann Lucille Lucinda Lucy Luella Lula Luna Lydia Lyla Lynda
  Lynette Lynn Lynne Mabel Mackenzie Macy Madalyn Maddison Madeleine Madeline Madelyn Madilyn Madison Mae Maeve Maggie
  Magnolia Makayla Malia Mallory Mamie Mandy Marcella Marcia Marcie Margaret Margarita Margie Margo Margot Maria Mariah
  Marian Marianne Marie Marilyn Marina Marion Marisa Marissa Marjorie Marla Marlene Marley Marsha Martha Mary Marybeth
  Mary-Kate Maryann Maryanne Matilda Mattie Maureen Maxine McKenna McKenzie McKinley McKayla Meagan Megan Meghan Melanie Melinda Melissa Melody
  Mercedes Meredith Mia Micaela Michaela Michele Michelle Mila Mildred Millie Mindy Minnie Miranda Miriam Missy Misty
  Molly Mona Monica Monique Morgan Muriel Myra Myrtle Nadine Nancy Naomi Natalia Natalie Natasha Nell Nellie Nettie
  Nicole Nikki Nina Noelle Nora Norah Norma Odessa Olive Olivia Opal Paige Pam Pamela Patrice Patricia Patsy Patti Patty
  Paula Paulette Pauline Payton Pearl Peggy Penelope Penny Peyton Philippa Phoebe Phyllis Piper Polly Poppy Portia
  Presley Priscilla Quinn Rachael Rachel Raegan Raelynn Reagan Reba Rebecca Rebekah Reese Regina Renee Rhea Rhoda Rhonda
  Rita Roberta Robin Robyn Rochelle Rosa Rosalie Rosalind Rosalyn Rose Roseann Rosemarie Rosemary Rosie Rowena Roxanne
  Ruby Ruth Ruthie Rylee Sabrina Sadie Sally Samantha Sandra Sandy Sara Sarah Sasha Scarlett Selena Selina Serena
  Serenity Shana Shannon Shari Sharon Shauna Shawna Sheila Shelby Shelia Shelley Shelly Sheri Sherri Sherry Shirley
  Sierra Simone Skye Skylar Sloane Sofia Sonia Sonja Sonya Sophia Sophie Stacey Staci Stacie Stacy Stella Stephanie
  Sue Summer Susan Susanna Susannah Susie Suzanne Suzette Suzy Sybil Sydney Sylvia Tabitha Talia Tamara Tami Tammie
  Tammy Tanya Tara Tatum Taylor Teagan Teresa Teri Terri Tess Tessa Thelma Theresa Tiffany Tina Toni Tonia Tonya Tori
  Tracey Traci Tracie Tracy Tricia Trinity Trisha Trudy Ursula Valerie Vanessa Vera Verna Veronica Vicki Vickie Vicky
  Victoria Viola Violet Virginia Vivian Viviana Vivienne Wanda Wendy Whitney Willa Willow Wilma Winifred Winnie Wren
  Yvette Yvonne Zoe Zoey Zoie`;

// (one name per word, space-separated; a hyphen where the name usually has one)
const NAMES = [
  ENGLISH_WOMEN,
  // American and English, men
  `Aaron Abe Abel Abraham Adam Addison Adrian Aidan Aiden Al Alan Albert Alden Alec Alex Alexander Alfred Alfredo
  Allan Allen Alton Alvin Ambrose Amos Anderson Andrew Andy Angus Anthony Archer Archie Arnie Arnold Art Arthur Artie
  Asher Atticus Aubrey Austin Avery Axel Barney Barrett Barry Bart Barton Beau Beckett Ben Benjamin Bennett Benny Bentley
  Bernard Bernie Bert Bill Billy Blaine Blake Bo Bob Bobby Boyd Brad Braden Bradford Bradley Brady Brandon Brantley
  Braxton Brayden Brendan Brennan Brent Brett Brian Brice Brock Broderick Brody Brooks Bruce Bryan Bryant Bryce Bryson
  Burt Byron Cade Caleb Callum Calvin Camden Cameron Carl Carlton Carroll Carson Carter Casey Cecil Cedric Chad
  Chadwick Chance Chandler Charles Charley Charlie Chase Chester Chet Chip Chris Christian Christopher Chuck Clarence
  Clark Claude Clay Clayton Clement Cletus Cliff Clifford Clifton Clint Clinton Clyde Cody Colby Cole Coleman Colin
  Collin Colt Colton Conner Connor Conor Conrad Cooper Corbin Cornelius Cory Corey Craig Curt Curtis Cy Cyrus Dale Dalton
  Damian Damien Damon Dan Dane Daniel Danny Darrell Darren Darrin Darryl Daryl Dave David Davis Dawson Declan Delbert
  Dennis Denny Denver Derek Derrick Desmond Devin Devon Dewey Dexter Dick Dillon Dirk Dominic Dominick Donald Donnie
  Donovan Dorian Doug Douglas Drew Duane Dudley Duncan Dustin Dusty Dwayne Dwight Dylan Earl Earnie Easton Ed Eddie Eddy
  Edgar Edmund Edward Edwin Eli Elias Elijah Elliot Elliott Ellis Elmer Elton Elvis Emerson Emery Emmett Emory Enoch Eric
  Erik Ernest Ernie Errol Ethan Eugene Evan Everett Ezekiel Ezra Felix Fernando Finn Finley Fletcher Floyd Forrest
  Francis Frank Frankie Franklin Fred Freddie Freddy Frederick Fredrick Gabe Gabriel Gage Garland Garrett Garrison Garry
  Gary Gavin Gene Geoffrey George Gerald Gerard Gideon Gil Gilbert Glen Glenn Gordon Grady Graham Grant Grayson Greg
  Gregg Gregory Greyson Griffin Grover Gus Guy Hal Hank Harlan Harold Harris Harrison Harry Harvey Hayden Hayes Heath
  Hector Henry Herb Herbert Herman Hiram Hobart Holden Homer Horace Howard Hubert Hudson Hugh Hugo Hunter Ian Ike Ira
  Irvin Irving Isaac Isaiah Ivan Jace Jack Jackie Jackson Jacob Jaden Jake Jameson James Jamie Jared Jarrett Jase Jason
  Jasper Jax Jaxon Jay Jayce Jayden Jed Jeff Jefferey Jeffery Jeffrey Jensen Jeremiah Jeremy Jerome Jerry Jesse Jessie
  Jett Jim Jimmie Jimmy Joe Joel Joey John Johnnie Johnny Jon Jonah Jonas Jonathan Jonathon Jordan Joseph Josh Joshua
  Josiah Judd Jude Julian Julius Justin Kaden Kai Kaleb Kane Karl Kayden Keaton Keegan Keith Kellan Kelvin Ken Kendall
  Kennedy Kenneth Kenny Kent Kevin Kieran Kingsley Kingston Kirby Kirk Knox Kurt Kurtis Kyle Kyler Lachlan Lamar Lance
  Landen Landon Lane Larry Lawrence Lawson Layne Lee Leif Leland Len Lenny Leo Leon Leonard Leroy Les Lester Levi Lewis
  Liam Lincoln Lindsey Lionel Lloyd Logan Lon Lonnie Lorenzo Louie Louis Lowell Luca Lucas Luke Luther Lyle Lyndon
  Mack Maddox Malcolm Marc Marcus Marion Mark Marlon Marshall Martin Marty Marvin Mason Mathew Matt Matthew Maurice
  Maverick Max Maximilian Maxwell Mel Melvin Merle Micah Michael Mickey Miguel Mike Miles Milo Milton Mitch Mitchell
  Monty Morgan Morris Mose Moses Murphy Murray Myles Nash Nate Nathan Nathanael Nathaniel Neal Ned Neil Nelson Nicholas
  Nick Nicky Nico Noah Noel Nolan Norman Norris Oliver Ollie Omar Orion Orville Oscar Oswald Otis Otto Owen Parker Pat
  Patrick Paul Paxton Percy Perry Pete Peter Phil Philip Phillip Pierce Porter Preston Quentin Quincy Quinn Quinton
  Ralph Randall Randolph Randy Ray Raymond Reed Reggie Reginald Reid Remington Rex Rhett Ricardo Richard Richie Rick
  Rickey Ricky Riley Rob Robbie Robby Robert Robin Rocky Rod Roderick Rodney Roger Roland Rolando Roman Ron Ronald
  Ronnie Rory Roscoe Ross Rowan Roy Royce Rudolph Rudy Rufus Russ Russell Rusty Ryan Ryder Ryker Sal Sam Sammy Samuel
  Sanford Sawyer Scott Seamus Sean Sebastian Seth Seymour Shane Shannon Shaun Shawn Shelby Sheldon Shelton Sherman Sid
  Sidney Silas Simon Skip Solomon Sonny Spencer Stan Stanley Stefan Stephen Sterling Steve Steven Stevie Stewart Stu
  Stuart Sylvester Tad Tanner Taylor Ted Teddy Terence Terrance Terrence Terry Thad Thaddeus Theo Theodore Thomas Tim
  Timmy Timothy Titus Toby Todd Tom Tommy Tony Trace Tracy Travis Trent Trenton Trevor Trey Tripp Tristan Troy Truman
  Tucker Ty Tyler Tyson Ulysses Uriah Van Vance Vaughn Vern Vernon Vic Vince Vincent Virgil Wade Walker Wallace Wally
  Walt Walter Warren Waylon Wayne Webb Wendell Wes Wesley Weston Whit Wilbert Wilbur Wiley Wilfred Will Willard
  William Willie Willis Wilson Winston Woodrow Woody Wyatt Xander Zach Zachariah Zachary Zack Zak Zander Zane Zeke
  Zeb Zebulon`,
  // Hyphenated given names written with their hyphen
  `Jo-Ann Jo-Anne Lee-Ann Leigh-Ann Ann-Marie Anne-Marie Mary-Jane Mary-Anne Mary-Ellen Mary-Lou Mary-Jo Sarah-Jane
  Lisa-Marie Mary-Beth Betty-Jo Billie-Jo Bobbie-Jo Lou-Ann`,
  // Two capitals people go by (initials said as a name)
  `TJ AJ CJ JJ PJ RJ JT KC MJ EJ`,
  // African American
  `Aaliyah Ahmad Aisha Akeem Akira Alfonso Alonzo Amani Amari Amina Andre Antoine Antonio Antwan Antwon Asia Ayana Ayanna
  Ayesha Brandon Bria Cedric Chanel Chantal Chante Chaka Ciara Cierra Cleon Cornell DaShawn Dajuan Damion Damon DaQuan
  Darius Darnell Dashawn Davion DeAndre Deandre DeAngelo Deja Dejah Delroy Demarco Demarcus Demetria Demetrius Denzel
  Deon Dequan DeShawn Deshawn Desean Deshaun Devante Devonte Diamond Dionne Dominique Donte Dontae Dwyane Ebony Eboni
  Ernestine Essie Fatima Garnett Imani Iesha Jabari Jada Jaden Jahmal Jaila Jakobe Jalen Jalisa Jamal Jamar Jamari Jameel
  Jamel Jamil Jamila Jaquan JaQuan Jarvis Jaylen Jaylin Jazmin Jazmine Jelani Jermaine Jerome Jevon Jewel Juwan Kadeem
  Kareem Kasim Kayla Keandre Keanu Keisha Kendrick Kenyatta Kenya Keon Kerry Keshawn KeShawn Keshia Keyshawn Khalil Kiana
  Kiara Kierra Kobe Kwame LaDonna LaKeisha Lakeisha Lakisha LaShawn Lashawn LaShonda Lashonda LaTanya Latanya LaTasha
  Latasha Latisha LaToya Latoya LaTonya Latonya Lavonne Leandra Lekisha Lucius Malachi Malik Marquis Marquise Marquez
  Marquita Mekhi Monae Monique Nia Niesha Nya Odell Okemah Raheem Rashad Rashaad Rasheed Rashida Raven Reginald Rodell
  Roshanda Roshawn Shakira Shalonda Shamar Shameka Shamika Shanae Shaneka Shanelle Shanice Shaniqua Shanita Shante
  Shaquille Shardae Shareef Sharonda Shayla Shemar Sheree Sherika Shirelle Shonda Shontae Tameka Tamika Tamia Tanesha
  Tanisha Tariq Tasha Tavon Tawanda Taye Terrell Tevin Tia Tiana Tierra Tomeka Torrance Tremaine Trevon Tyesha Tyra
  Tyree Tyreek Tyrell Tyrese Tyrique Tyrone Tyshawn Valencia Wendell Xavier Yolanda Yvette Zaire Zakiya Zaria
  D'Andre D'Angelo De'Andre De'Aaron DeAaron Ja'Marr Ja'Quan Ke'Shawn Da'Quan De'Shawn La'Tonya Ta'Nisha`,
  // Hispanic and Latino, Portuguese and Brazilian
  `Abelardo Abril Adán Adolfo Adriana Agustín Agustina Aida Alberto Alejandra Alejandro Alessandra Alfonso Alicia Alma
  Alondra Álvaro Amalia Amparo Ana Anabel Analía Andrés Ángel Angélica Aníbal Antonia Antonio Araceli Ariadna Armando
  Arturo Aurelio Bárbara Beatriz Benicio Benito Bernardo Blanca Brenda Bruno Camila Candelaria Carina Carla Carlos
  Carlota Carmela Carmelo Carmen Carolina Catalina Cecilia Celia César Claudia Clemente Concepción Consuelo Cristian
  Cristina Cristóbal Dalia Daniela Dante Darío David Débora Diego Dolores Domingo Edgar Edgardo Eduardo Efraín Elena
  Eliseo Elisa Elsa Elvira Emiliano Emilio Enrique Erika Ernesto Esmeralda Esperanza Estefanía Estela Esteban Eugenio
  Eva Evelia Fabián Fabiola Facundo Federico Felipe Félix Fermín Fernanda Fernando Fidel Flor Francisca Francisco
  Gabriela Gael Gerardo Gilberto Gisela Gloria Gonzalo Graciela Gregorio Guadalupe Guillermo Gustavo Héctor Helena
  Hernán Hilda Horacio Hugo Humberto Ignacio Inés Ingrid Irene Iris Irma Isabel Isidro Ismael Itzel Iván Jacinto Jaime
  Javier Jazmín Jesús Joaquín Jorge José Josefina Juan Juana Julián Juliana Julio Leonardo Leonel Leticia Lidia Liliana
  Lizbeth Lorena Lourdes Lucas Lucía Luciana Luis Luisa Lupe Luz Macarena Magdalena Manuel Manuela Marcela Marcelo
  Marco Marcos Margarita María Mariana Maribel Maricela Marisol Mario Marta Martín Martina Mateo Matías Mauricio Maximiliano
  Mercedes Micaela Miguel Milagros Mireya Moisés Mónica Nadia Natalia Nayeli Nelson Nicolás Noemí Norma Octavio Olga
  Omar Orlando Óscar Osvaldo Pablo Paloma Paola Pascual Patricio Paula Paulina Pedro Perla Pilar Ramiro Ramón Raquel
  Raúl Rebeca Reina Renata Reynaldo Ricardo Roberto Rocío Rodolfo Rodrigo Rogelio Rolando Rosa Rosalía Rosario Rosaura
  Rubén Salvador Samuel Sandra Santiago Santos Sara Sebastián Selena Sergio Silvia Simón Socorro Sofía Soledad Susana
  Teodoro Teresa Tomás Valentina Valeria Vanesa Verónica Vicente Víctor Virginia Viviana Wilfredo Ximena Xiomara Yadira
  Yesenia Yolanda Yuliana Zoila Adalberto Anselmo Ezequiel Valentín Gaspar Leandro Lisandro Joel Josué Abigaíl Yaretzi
  Dulce Itzayana Jimena Regina Romina Monserrat Montserrat Paulo João Joao Tiago Thiago Gonçalo Rui Luiz Vinícius
  Matheus Mateus Gustavo Rafael Rafaela Bianca Larissa Letícia Leticia Juliana Fernanda Camila Gabriel Lucas Vitória
  Isadora Heloísa Beatriz Conceição Graça Fátima Antônio Sebastião Raimundo Francisca Marcos Wellington Washington
  Zé Zezé Cauã Davi Enzo Bernardo Lorena Thaís Tatiana Priscila Adriano Fabrício Rodrigo Renan Ronaldo Sérgio Mauro Glória
  Maite Itziar Iker Aitana Ainhoa Nerea Begoña Iñaki Arantxa Jordi Montse Núria Pau Gal\u00B7la Mireia Quim Xavier`,
  // Caribbean: Haitian, French Caribbean, Jamaican, Trinidadian, Dominican, Puerto Rican
  `Jean Jean-Baptiste Jean-Claude Jean-Pierre Jean-Paul Jean-Marc Jean-Luc Jean-Louis Jean-Michel Jean-Philippe
  Jean-Jacques Jean-Robert Jean-Marie Jean-Charles Jean-François Jean-Yves Marie-Claire Marie-Ange Marie-Louise
  Marie-Thérèse Marie-Josée Marie-France Marie-Hélène Rose-Marie Anne-Marie Marie-Rose Marie-Carmelle Pierre Rose
  Fabiola Guerda Jocelyne Kettly Lunise Micheline Nadège Roselande Yolette Wilner Wilfrid Fritz Garry Jacky Jocelyn
  Ricardo Delroy Desmond Everton Fitzroy Kemar Kemoy Leroy Oneil O'Neil Orville Rohan Shanice Shauna Tevin Winston
  Kadeem Shamar Akeem Jermaine Damion Dwayne Andre Junie Lovens Wesner Wislande Wideline Widline Roodly Rony Ronald
  Jameson Johnson Stanley Carline Darline Mirlande Myrlande Nathalie Sabine Sherline Bernadin Dieudonné Dieudonne
  Ludovic Lucner Maxo Pascale Rosemond Yves Yvrose Altagracia Yokasta Yahaira Yanira Yaritza Yesica Wanda Nilda
  Migdalia Maritza Marilú Lisette Lizette Iliana Ivelisse Haydée Gisselle Fausto Fernán Elvin Edwin Wilson Nelson
  Nestor Ángelo Ezequiel Héctor Waldo Benny Felo Kervin Kerwin Marlon Rawle Ramesh Anil Krystal Keisha Nadia Natalie
  Tricia Simone Shellyann Stacy-Ann Kerry-Ann Sherry-Ann Joy-Ann Mary-Ann Lisa-Marie Kimone Kamoy Tajay Shevon Shawna
  Yanique Tashana Tishauna Rushane Romario Odane Jovaughn Jovan Javon Tyreke Tafari Rasheed Omari Nkosi`,
  // West African: Nigerian (Yoruba, Igbo, Hausa), Ghanaian (Akan, Ewe, Ga), Senegalese, Malian, Guinean, Liberian,
  // Sierra Leonean, Ivorian, Cameroonian
  `Ade Adebayo Adebola Adeleke Adeola Adesuwa Adewale Adeyemi Adaeze Adanna Adaora Adeline Adenike Aderonke Adetokunbo
  Adewunmi Ayo Ayodele Ayodeji Ayomide Ayotunde Babajide Babatunde Bisi Biodun Bola Bolaji Bukola Busola Chiamaka
  Chibuike Chibuzo Chidi Chidinma Chidera Chidozie Chiemeka Chigozie Chika Chikezie Chima Chimamanda Chinedu Chinelo
  Chinonso Chinwe Chioma Chisom Chukwudi Chukwuemeka Chukwuma Damilola Dapo Dayo Ebere Ebuka Ejike Emeka Ezinne Femi
  Folake Folasade Folashade Funke Funmi Funmilayo Gbenga Ifeanyi Ifeoma Ifunanya Ijeoma Ikechukwu Ikenna Jide Kayode
  Kehinde Kelechi Kemi Kenechukwu Kunle Lanre Lola Lolade Moji Mojisola Morenike Nkem Nkechi Nkiruka Nnamdi Nneka Nnenna
  Ngozi Niyi Obinna Ogechi Olabisi Oladele Olamide Olanrewaju Olasunkanmi Olu Oluchi Olufemi Olumide Oluwadamilare
  Oluwafemi Oluwakemi Oluwaseun Oluwatobi Oluwatoyin Onyeka Onyinye Remi Sade Segun Seun Shola Sola Somto Taiwo Temi
  Temitope Tobi Tochukwu Tolu Tolulope Tope Toyin Tunde Uche Uchenna Ugochi Ugonna Uzoma Wale Wunmi Yemi Yetunde Zainab
  Abubakar Aliyu Aminu Bashir Bello Danjuma Garba Hadiza Halima Hauwa Ibrahim Idris Jamilu Kabiru Lawal Maryam Musa
  Nasiru Rabiu Sani Shehu Umar Usman Yakubu Yusuf Zainab Abena Adjoa Adwoa Afia Afua Akosua Akua Ama Amma Efua Esi Kojo
  Kofi Kwabena Kwadwo Kwaku Kwame Kwasi Kwesi Yaa Yaw Akwasi Ekow Fiifi Kobina Kodwo Paa Yao Mawuli Selorm Senyo Edem
  Elikem Dzifa Sena Delali Enyonam Esinam Nii Naa Adoley Korkor Amadou Mamadou Moussa Ousmane Aminata Fatou Mariama
  Ibrahima Abdoulaye Sekou Kadiatou Binta Oumar Aissatou Awa Coumba Khady Ndeye Penda Seynabou Assane Babacar Lamine
  Modou Moustapha Pape Souleymane Cheikhou Alioune Boubacar Djibril Mamadi Bakary Fanta Hawa Kadidia Oumou Salif Seydou
  Sidiki Tidiane Adama Alpha Thierno Mohamed Sia Musu Kebeh Comfort Blessing Precious Patience Mercy Godwin Emmanuel
  Ekene Nnaemeka Somtochukwu Chibueze Kosisochukwu Oluwatosin Tosin Toluwani Ireti Ifedayo Oyinda Teniola Simisola Tiwa
  Tiwalade Mofe Efe Osagie Osaze Eghosa Uyi Osas Ehis Ese`,
  // East African: Ethiopian, Eritrean, Kenyan, Somali, Ugandan, Tanzanian, Rwandan, Sudanese
  `Abebe Abel Almaz Amare Amanuel Aster Bekele Belay Bethel Biniam Biruk Dawit Eleni Ermias Eyob Fasika Feven Fikru
  Genet Girma Haile Hailu Hana Helen Hiwot Kebede Kidist Kidus Lemlem Liya Mahlet Mekdes Meron Mesfin Mulugeta Nardos
  Rahel Saba Selam Semhar Senait Solomon Tadesse Tekle Tesfaye Tigist Tsion Wondimu Yonas Yohannes Yared Yordanos
  Zewdu Zerihun Abrham Aklilu Alemayehu Berhane Desta Ephrem Filmon Habtom Kibrom Medhanie Mussie Natnael Robel Samson
  Sara Tewodros Weyni Winta Yemane Achieng Akinyi Atieno Awino Adhiambo Baraka Imani Jabari Jelani Juma Kamau Kariuki
  Kioko Mumbua Mwende Nafula Neema Njeri Nyokabi Ochieng Odhiambo Omondi Otieno Wairimu Wambui Wangari Wanjiku Wanjiru
  Waweru Zawadi Amani Halima Barack Kipchoge Kiprop Chebet Jepchirchir Wekesa Wafula Makena Muthoni Nyambura Kagwe
  Abdi Abdikarim Abdirahman Ayaan Ayan Faisal Farah Fartun Hodan Hawa Ilhan Istahil Khadra Mohamud Muna Nimco Sahra
  Hamdi Ifrah Iqra Ismahan Kaltun Sagal Ubah Warsan Yasmin Zamzam Akello Apio Aine Kato Mukasa Nakato Babirye Wasswa
  Mugisha Uwase Ishimwe Keza Ineza Mutesi Gatete Kagame Manzi Neza Teta Amahoro Akol Deng Nyandeng Achol Garang Majok`,
  // South Asian: Indian, Pakistani, Bangladeshi, Sri Lankan, Nepali
  `Aarav Aarthi Aarti Amartya Aditi Aditya Ahana Aishwarya Ajay Ajit Akash Akhil Akshay Alok Amar Amit Amita Amitabh Amol Amrita
  Anand Ananya Anika Anil Anita Anjali Anjana Ankit Ankita Anoop Anuj Anupam Anuradha Anushka Aparna Archana Arjun Arnav
  Arpita Arun Aruna Arvind Asha Ashish Ashok Ashwin Atul Avinash Ayush Bhavana Bhavna Chandan Chandra Chetan Deepa Deepak
  Deepika Devendra Devika Dhruv Dilip Dinesh Divya Durga Gaurav Gautam Geeta Gita Girish Gopal Govind Hari Harish Harsh
  Harsha Hema Hemant Indira Isha Ishaan Ishan Jagdish Jatin Jaya Jayant Jayesh Jyoti Kailash Kajal Kalpana Kamal Kamala
  Karan Karthik Kartik Kavita Kavya Keshav Kiran Kishore Krishna Kunal Lakshmi Lalit Lata Madhu Madhavi Mahesh Manisha
  Manish Manoj Meena Meera Megha Mira Mohan Mohini Mukesh Murali Nalini Nandini Naresh Naveen Neel Neelam Neha Nikhil
  Nikita Nilesh Nisha Nitin Padma Pallavi Pankaj Parth Pooja Prabhu Pradeep Prakash Pranav Prasad Prashant Praveen
  Preeti Prem Priti Priya Priyanka Puja Rachana Radha Raghav Rahul Raj Rajan Rajeev Rajesh Rajiv Rakesh Ram Ramesh Rani
  Ranjit Rashmi Ravi Reena Rekha Ritu Rohan Rohit Ruchi Rupa Sachin Sahil Sai Samir Sandeep Sangeeta Sanjay Sanjeev
  Santosh Sapna Sarita Satish Shalini Shankar Sharmila Shashi Sheetal Shilpa Shiv Shiva Shreya Shruti Shweta Siddharth
  Simran Sita Smita Sneha Sonal Sonali Suman Sumit Sunil Sunita Suresh Surya Sushil Swati Tanvi Tarun Uday Uma Usha
  Varun Veena Vidya Vijay Vikas Vikram Vinay Vinod Vipin Vishal Vivek Yash Yogesh Zara Abhay Abhishek Ashwini Bhavesh
  Chirag Darshan Dev Dhanya Gayatri Hardik Hiral Jignesh Kinjal Komal Krupa Mitesh Nirav Nupur Parul Payal Pinal Rupal
  Sejal Snehal Tejas Urvi Vaishali Viral Aditi Anaya Diya Ira Kiara Myra Navya Saanvi Sara Siya Vihaan Vivaan Reyansh
  Ayaan Kabir Advait Arush Ishita Riya Shriya Trisha Harpreet Gurpreet Jaspreet Manpreet Navneet Simranjit Amandeep
  Arshdeep Baljit Gurdeep Harjit Inderjit Jasbir Kuldeep Mandeep Parminder Rajinder Sukhwinder Taranjit Balwinder
  Ahsan Asif Faisal Farhan Hamza Imran Irfan Junaid Kamran Nadeem Naveed Rizwan Sajid Shahid Tahir Usman Waqar Zeeshan
  Adnan Bilal Danish Fahad Haris Hassan Kashif Mubashir Nauman Saad Salman Shoaib Sohail Umair Yasir Zubair Ayesha Bushra
  Hina Iqra Javeria Mahnoor Maria Mehwish Nida Rabia Saba Sadia Saima Sana Shazia Sidra Uzma Zainab Zoya Anwar Arif
  Habib Jahangir Kabir Mizanur Nazrul Rafiq Rahim Rashed Rubel Shafiq Shamim Shirin Tanvir Taslima Nusrat Farzana
  Fahmida Jannat Mithila Rupa Shapla Tania Anika Dilini Harini Kasun Nimal Nuwan Ruwan Sanjeewa Thilini Chathura Dinuka
  Ishara Kumari Lahiru Madhavi Sachini Tharindu Bikash Bishnu Kamala Prabin Pramila Sabina Sagar Sanjana Suraj Sushila`,
  // East and Southeast Asian (given names, as usually romanized), each people's own (round 21: so a family name that comes
  // first can be told by the given name after it, "Sam Rainsy", "Joe Min-ji")
  CHINESE, JAPANESE, KOREAN, VIETNAMESE, FILIPINO, THAI, INDONESIAN, HMONG, BURMESE, KHMER, LAO,
  // Arabic, Persian, Turkish, Afghan, Central Asian
  `Muhammad Mohammed Mohamed Mohammad Mohamad Ahmad Ahmed Ali Omar Umar Yusuf Youssef Yousef Joseph Ibrahim Ismail Hassan
  Hasan Hussein Husain Hossein Khalid Khaled Tariq Tarek Karim Kareem Rashid Rasheed Samir Sameer Sami Nabil Walid Faisal
  Hamza Bilal Adil Adel Amir Ameer Ayman Bashir Fadi Fahad Fares Faris Firas Ghassan Habib Hadi Haitham Hakim Hani Hatem
  Hisham Imad Issa Jamal Jamil Jihad Kamal Khalil Majid Malik Mahmoud Mahmud Mansour Marwan Mazen Mohsen Mostafa Mustafa
  Munir Murad Nader Nadim Nasser Nizar Omar Osama Qasim Rami Ramzi Raed Riad Riyad Saad Saeed Said Salah Saleh Salim
  Saleem Sameh Shadi Sharif Suleiman Sulaiman Tamer Tawfiq Wael Waleed Yahya Yasser Yasir Zaid Zayd Zakaria Ziad Ziyad
  Fatima Aisha Ayesha Khadija Maryam Mariam Zainab Layla Leila Laila Noor Nour Nur Huda Hana Hanan Rania Salma Yasmin
  Yasmine Jasmin Amina Amira Samira Sara Rana Dina Lina Reem Rim Mona Noura Abla Asma Aya Basma Dalia Duaa Eman Iman
  Farah Ghada Hala Hiba Hind Inas Jana Jumana Lama Lamia Lubna Maha Maysa Mayada Nadia Najla Nawal Nisreen Rasha Rawan
  Rula Safa Samar Sana Sawsan Shaima Suha Tala Wafa Yara Zahra Zeina Zaina Abdullah Abdallah Abdulaziz Abdulrahman
  Abdelrahman Abdelkader Abdulla Reza Mehdi Arash Babak Behnaz Darius Dariush Farhad Farzad Laleh Mina Nasrin Parisa
  Parvin Roya Shirin Shahram Siamak Soraya Yasaman Kian Cyrus Navid Omid Payam Pegah Neda Nima Ramin Saman Sina Shiva
  Ladan Mahnaz Azadeh Bahar Golnaz Mitra Niloufar Shabnam Ziba Afshin Ardalan Bahram Behrouz Dariush Ehsan Farid Hamid
  Houman Kambiz Kamran Kaveh Keyvan Majid Mani Manouchehr Masoud Mehran Mehrdad Mohsen Morteza Nader Parham Parviz Pouya
  Ramtin Reza Saeid Shahin Sohrab Vahid Yasin Afsaneh Anahita Arezoo Atefeh Elham Fereshteh Golnar Haleh Leyla Mahsa
  Maryam Mehrnaz Minoo Nazanin Negar Nooshin Pardis Parastoo Roxana Sahar Sepideh Setareh Shadi Shahla Simin Taraneh
  Zohreh Ahmet Mehmet Mustafa Emre Burak Can Cem Deniz Ece Elif Emine Esra Fatma Hakan Hande Kemal Kerem Murat Oğuz Onur
  Ozan Selin Serkan Sinan Tolga Ufuk Yusuf Zeynep Ayşe Aylin Berk Cansu Derya Ebru Gizem Gül Hatice İbrahim Ibrahim
  Merve Melis Nihan Ömer Omer Özge Pınar Sevgi Tuba Yasemin Yiğit Arda Baran Barış Eren Furkan Kaan Mert Ozgur Volkan
  Rustam Farrukh Dilnoza Gulnara Aziz Timur Rustem Nargiza Zarina Jamshid Bakhtiyor Dilshod Azamat Aibek Aigerim Nurlan
  Ahmad Wali Zalmay Farid Fawad Freshta Mursal Nargis Parwin Shabana Zarghona Zarlasht Wahid Mirwais`,
  // Hebrew and Jewish
  `Avi Avraham Avram Ari Ariel Asher Benjamin Boaz Chaim Dov Dovid Eli Eliana Eliezer Elisha Ezra Gideon Ilan Itai Itay
  Lior Moshe Noam Oren Shai Shira Tamar Talia Yael Yosef Yehuda Yitzhak Zev Aviva Batya Chana Chaya Devorah Esther Leah
  Miriam Naomi Rivka Sarah Shoshana Tova Yonatan Amit Eitan Meir Shlomo Shmuel Yaakov Yair Uri Ofer Gal Dana Noa Maya
  Hila Michal Rachel Rina Ruth Ronit Adina Ahuva Aliza Avital Ayelet Bracha Dalia Efrat Elisheva Gila Hadas Hadassah
  Liora Malka Meital Moriah Nechama Orly Rena Rivkah Sigal Tali Tzipora Yaffa Yehudit Zehava Akiva Amnon Amos Asaf Assaf
  Baruch Dror Ehud Eyal Gilad Hillel Idan Lev Menachem Mordechai Nachum Nadav Nir Nissim Omri Raphael Reuven Ronen Shimon
  Tal Tzvi Yechiel Yehoshua Yigal Yoav Yoel Yossi Ziv Zvi Pinchas Mendel Shalom Leib Yisrael Israel Yitzchak Aharon
  Avigail Batsheva Chava Dina Hadar Keren Liat Maayan Neta Noga Orit Shani Shulamit Tziona Yonit`,
  // European: French, German, Austrian, Swiss, Dutch, Belgian, Italian, Polish, Czech, Slovak, Hungarian, Romanian,
  // Russian, Ukrainian, Belarusian, Balkan, Greek, Nordic, Baltic, Irish, Scottish, Welsh
  `Amélie André Antoine Benoît Bernadette Brigitte Camille Céline Chantal Claude Clément Colette Delphine Denis Didier
  Dominique Élise Émile Émilie Étienne Fabien Fabienne Florian Florence François Françoise Gaston Geneviève Georges
  Gérard Guillaume Hélène Henri Hervé Isabelle Jacques Jeanne Jérôme Joëlle Josette Julien Laurent Laurence Lucie Luc
  Madeleine Manon Marc Marcel Margaux Marguerite Martine Mathieu Mathilde Maxime Michel Mireille Monique Nathalie Nicolas
  Odette Olivier Pascal Patrice Philippe Rémi Rémy René Renée Romain Sébastien Serge Simone Solène Sophie Stéphane
  Sylvain Sylvie Thierry Thibault Valérie Véronique Vincent Yann Yannick Yves Zoé Aurélie Aurélien Baptiste Bastien
  Cédric Clémence Corentin Damien Édouard Éloïse Gaëlle Gilles Hugues Inès Jules Léa Léon Léonie Loïc Lucien Maël Noémie
  Océane Quentin Raphaël Thérèse Timothée Andreas Anke Annegret Bernd Birgit Brigitte Christoph Claudia Dieter Dirk
  Elke Ernst Frank Franz Friedrich Fritz Gerhard Gisela Gottfried Gudrun Günter Günther Gunter Hannelore Hans Heidi
  Heike Heinrich Heinz Helga Helmut Herbert Hermann Hildegard Holger Horst Ilse Ingeborg Ingrid Jens Joachim Johann
  Jörg Jürgen Karin Karl Katja Katrin Klaus Kurt Lars Lothar Lukas Manfred Margit Markus Martina Matthias Monika Norbert
  Otto Petra Rainer Ralf Reinhard Renate Rolf Rudolf Sabine Sandra Silke Stefan Steffen Susanne Sven Thorsten Thomas
  Torsten Ulrich Ulrike Ursula Uwe Volker Walther Werner Wilhelm Wolfgang Wolf Jannik Jonas Leon Lena Lea Luisa Maximilian
  Felix Finn Niklas Tobias Florian Sebastian Jan Bram Daan Femke Joost Jeroen Lotte Maarten Pieter Ruud Sanne Wouter
  Anouk Bart Bas Dirk Eva Floor Geert Hendrik Henk Ilse Inge Jaap Jasper Joris Kees Koen Lieke Luuk Marieke Mark Niels
  Noor Pim Rik Roel Sander Sem Stijn Thijs Tim Tom Ties Willem Annalisa Annamaria Alessandro Alessia Alberto Andrea Angelo Antonella
  Antonio Arianna Beatrice Benedetta Bruno Carla Carlo Chiara Claudio Cristina Daniele Davide Domenico Elena Elisa
  Emanuele Enrico Enzo Fabio Fabrizio Federica Federico Filippo Francesca Francesco Franco Gabriele Giacomo Gianluca
  Gianni Gino Giorgia Giorgio Giovanna Giovanni Giulia Giuliana Giuliano Giulio Giuseppe Ilaria Leonardo Lorenzo Luca
  Lucia Luciano Luigi Marcello Marco Margherita Mario Marta Martina Massimo Matteo Mattia Maurizio Michele Nicola Nicolò
  Paola Paolo Pietro Raffaele Riccardo Roberta Roberto Rocco Salvatore Sergio Silvia Simona Simone Sofia Stefania
  Stefano Teresa Tommaso Valentina Valerio Vincenzo Vittoria Vittorio Agnieszka Aleksandra Anna Bartosz Beata Danuta
  Dariusz Dorota Elżbieta Ewa Grażyna Grzegorz Halina Irena Jakub Janina Jerzy Joanna Józef Justyna Kamil Karolina
  Katarzyna Kazimierz Krystyna Krzysztof Łukasz Lukasz Maciej Magdalena Małgorzata Malgorzata Marcin Marek Mariusz
  Mateusz Michał Michal Monika Natalia Paweł Pawel Piotr Przemysław Rafał Renata Robert Sebastian Stanisław Tadeusz
  Teresa Tomasz Urszula Wiesław Witold Wojciech Zbigniew Zofia Zuzanna Jiří Jiri Jana Jaroslav Lenka Lucie Martin
  Milan Miroslav Pavel Petr Tereza Václav Vaclav Zdeněk Zdenek Ondřej Ondrej Marek Lubomir Ľubomír Katarína Zoltán
  Zoltan László Laszlo Attila Gábor Gabor István Istvan Ferenc Katalin Erzsébet Zsófia Zsofia Balázs Balazs Csaba
  Andrei Andreea Bogdan Cristian Florin Ioana Ion Ionuț Mihai Mihaela Radu Raluca Sorin Vlad Adrian Aleksandr Alexei
  Alexey Alyona Anastasia Andrey Anton Anya Artem Boris Daria Denis Dmitri Dmitry Ekaterina Galina Igor Ilya Irina Ivan
  Katya Kirill Konstantin Larisa Lyudmila Maxim Mikhail Nadezhda Natalya Natasha Nikita Nikolai Oksana Oleg Olga Pavel
  Polina Roman Ruslan Sergei Sergey Sofya Stanislav Svetlana Tatiana Tatyana Timofey Vadim Valentina Valery Vasily
  Viktor Vladimir Vladislav Yana Yaroslav Yevgeny Yulia Yuri Zhanna Bohdan Dmytro Halyna Ivanna Mykola Mykhailo Olena
  Oleksandr Oleksii Petro Serhiy Taras Volodymyr Yaroslava Yuliia Andrija Branko Dragan Dušan Dusan Goran Jelena Marija
  Milica Miloš Milos Nikola Snežana Stefan Vesna Zoran Željko Ana Ante Ivana Josip Luka Marko Mateja Petra Tomislav
  Amra Emina Haris Jasmina Mirza Selma Adnan Alexandros Athena Christos Constantine Despina Dimitri Dimitrios Eleni
  Evangelia Georgios Giorgos Ioannis Katerina Konstantinos Kostas Maria Nikos Panagiotis Penelope Sofia Spiros Stavros
  Theodora Thanos Vasilis Yannis Yiannis Anders Astrid Bjorn Björn Erik Freya Gunnar Ingrid Lars Leif Linnea Magnus
  Nils Olaf Sigrid Sven Thor Søren Soren Mette Kirsten Lasse Mads Henrik Morten Rasmus Jesper Kasper Mikkel Anneli Elin
  Hanna Ida Johan Karin Kristian Linnéa Maja Malin Oskar Stina Tove Vilhelm Åsa Asa Ingvar Jonna Liisa Aino Eero Juha
  Jukka Kaisa Mikko Pekka Sanna Tuomas Ville Jonas Rūta Ruta Gintaras Aigars Ilze Jānis Janis Kristaps Liene Toomas
  Aidan Aoife Brendan Bridget Cian Ciara Cormac Declan Deirdre Eamon Eamonn Eoin Fiona Liam Niamh Oisin Orla Padraig
  Ronan Saoirse Seamus Sean Seán Siobhan Sinead Sinéad Aisling Caoimhe Ciaran Colm Conor Darragh Donal Dermot Eileen
  Eimear Grainne Kieran Maeve Muireann Nuala Oonagh Ruairi Seanán Tadhg Una Ailsa Alasdair Alastair Callum Catriona
  Euan Ewan Fergus Hamish Iain Isla Kirsty Lachlan Morag Mhairi Rhona Rory Struan Angharad Bethan Bronwen Cerys Dafydd
  Dylan Emrys Gareth Gethin Gwyneth Huw Ieuan Iwan Llewellyn Megan Rhian Rhys Sian Siân Tegan Owain`,
  // Common nicknames and short forms people go by
  `Abby Addy Al Alf Alfie Ally Andy Annie Archie Artie Augie Barb Barbie Becca Becky Bel Benji Benny Bernie Bert Bertie
  Bess Bessie Bev Bill Billie Billy Bob Bobbi Bobbie Bobby Brad Cal Carrie Cass Cassie Cat Cathy Charlie Chaz Chet Chris
  Chrissie Chrissy Chuck Cindy Clem Connie Dan Dani Danny Dave Davey Davy Deb Debbie Debby Dee Denny Dottie Doug Drew Ed
  Eddie Effie Ellie Em Emmy Ernie Evie Fran Frannie Freddie Freddy Gabby Gabe Gene Gerry Gil Gina Ginny Greg Gus Gwen
  Hal Hank Harry Hattie Herb Herbie Ike Izzy Jack Jackie Jake Jamie Jan Jen Jenn Jenny Jerry Jess Jessie Jill Jim Jimmie
  Jimmy Jo Jodie Jody Joe Joey Johnny Jon Jonny Josh Josie Judy Julie Kat Kate Kathy Katie Katy Ken Kenny Kim Kris
  Kristy Larry Len Lenny Leo Les Lexi Lexie Libby Liz Liza Lizzie Lizzy Lou Louie Lucy Lulu Maddie Maddy Mandy Manny
  Marge Margie Marty Matt Mattie Matty Max Meg Mel Mick Mickey Mike Mikey Millie Mindy Missy Mitch Mo Moe Molly Nat Nate
  Ned Nell Nellie Nick Nicky Nikki Ollie Pam Pat Patsy Patti Patty Peggy Penny Pete Phil Polly Randy Ray Reggie Rick
  Ricky Rob Robbie Robby Rod Ron Ronnie Rosie Rudy Russ Ruthie Sadie Sal Sally Sam Sammie Sammy Sandy Shelly Sid Stan
  Steph Steve Stevie Stu Sue Susie Suzy Tad Tammy Ted Teddy Terry Tess Tim Timmy Tina Toby Tom Tommy Toni Tony Tracy
  Trish Trudy Val Vic Vicky Vince Vinny Viv Wally Walt Wes Will Willie Willy Winnie Woody Zach Zack Zeke Bea Birdie Bunny
  Cece Dot Fifi Flo Hettie Kitty Lettie Lottie Midge Minnie Netta Nettie Queenie Sissy Trixie Vonnie Wendi Ziggy Babs
  Bart Bud Buzz Chas Clint Duke Fitz Gabe Jeb Kit Mac Mack Mort Ned Nico Pip Rafe Rex Sly Smitty Teo Tito Topher`,
];

// Never greeted, though a list above may have them: taken out after the lists are read, so an addition above can't
// bring one back. Titles, offices and family words (Duke, Mirza, Wali, Lama, Shehu, Thierno, Pape, Ndeye, Nii, Naa, Paa,
// Rani, Reina, Putri, Siti, Kumari, Prabhu, Mac), places (Kenya, Asia, Valencia, Odessa, Denver, Washington, Wellington,
// Emory, Bethel), everyday English words rarely a name here (Chance, Chip, Skip, Trace, Floor, Ties, Ion, Ante, Can, Said,
// Rim, Hind, Belay, Danish, Dung, Loan, Yen, Lien, Ploy, Gang, Sun, Long, Hang, Sang, My, Do, Bin, An, Na, Chi), family
// names more often than given names (Davis, Harris, Anderson, Bryant, Brooks, Hayes, Lawson, Coleman, Walker, Wilson,
// Johnson, Santos, Domingo, Kamau, Otieno, Deng, Garang), a brand (Fanta, Kia), and short forms read as other things
// (Ma, Pa, Dee, Thi, Tu, Van). (A plain string, split when a greeting first asks, as every list here is: round 21, so the
// page's bundle, which imports _advisory-form.js and so this file, leaves it out with the rest)
const NEVER = `Bud Buzz Dot Duke Kit Mac Mack Sly Ma Pa Fifi Queenie Bunny Birdie Sissy Babs Smitty Pip Fitz Cat Bel Vonnie
Wolf Diamond Comfort Ziggy Chance Kenya Asia Valencia Odessa Johnson Washington Wellington Lama Jewel Okemah Ram Rani
Chai Nok Pim Tai Tho Thi Truc Tu Bich Hang Long Sang My Ho Do Mali Siti Dee Mort Sia Paa Naa Nii Sena Alpha Bello Garba
Lawal Kagame Deng Rhee Bethel Belay Chi An Na Bin Gang Sun Dung Loan Yen Lien Ploy Putri Kia Said Rim Hind Can Wali
Mirza Shehu Pape Fanta Thierno Ndeye Kamau Kariuki Waweru Wekesa Wafula Kagwe Odhiambo Otieno Ochieng Omondi Kipchoge
Kiprop Chebet Jepchirchir Kioko Mukasa Gatete Manzi Amahoro Garang Kumari Prabhu Prasad Danish Reina Santos Domingo
Floor Ties Ion Ante Una Gal Shalom Dixie Carroll Davis Harris Anderson Bryant Brooks Hayes Lawson Coleman Garland
Garrison Sanford Walker Wilson Emory Denver Skip Chip Trace Van Felo Chas`;

// Two given names people go by together (round 20): a name they go by of two words, or a first word of two names joined
// by a hyphen, is greeted only when it's one of these, or a hyphenated name on the lists above ("Jo-Ann", "Min-jun").
// Two given names alone are no evidence: "Katie Harrison", "Dana Kim" and "Jo—Joanna" are a given name and a family name,
// or two names, as often
const DOUBLE = `Mary_Beth Mary_Ann Mary_Anne Mary_Jane Mary_Kate Mary_Grace Mary_Catherine Mary_Margaret Mary_Elizabeth
Mary_Ellen Mary_Lou Mary_Jo Mary_Alice Mary_Frances Mary_Helen Mary_Kay Mary_Lynn Mary_Louise Mary_Clare Mary_Claire
Mary_Rose Mary_Katherine Mary_Kathryn Mary_Pat Mary_Sue Anna_Grace Ella_Grace Emma_Grace Sarah_Grace Anna_Kate
Anna_Claire Anna_Beth Sarah_Beth Sara_Beth Lee_Ann Leigh_Ann Lou_Ann Jo_Ann Jo_Anne Jo_Beth Betty_Jo Billie_Jo
Bobbie_Jo Peggy_Sue Betty_Lou Billy_Bob Billy_Joe Billy_Ray Bobby_Joe John_Paul John_Michael John_David John_Mark
John_Robert John_Henry John_Thomas Ann_Marie Anne_Marie Rose_Marie Rose_Ann Lisa_Marie Sarah_Jane Sara_Jane Ella_Mae
Anna_Mae Lilly_Mae Lily_Mae Ruby_Mae Annie_Mae Ellie_Mae Willie_Mae Carrie_Ann Julie_Ann Kelly_Ann Kerry_Ann Lori_Ann
Anna_Maria Ana_Maria María_José Juan_Carlos Juan_Pablo Juan_Manuel Juan_Antonio Juan_José Juan_Luis Juan_David
José_Luis José_Antonio José_Manuel José_María José_Miguel Luis_Miguel Luis_Fernando Luis_Alberto Carlos_Alberto
Miguel_Ángel María_Elena María_Teresa María_Fernanda María_Isabel María_Luisa María_Paula María_Camila Ana_Lucía
Ana_Sofía Ana_Paula Ana_Isabel Ana_Laura Luz_María Rosa_María Jean_Pierre Jean_Luc Jean_Paul Jean_Claude Jean_Marc
Jean_Louis Jean_Michel Jean_Philippe Jean_Baptiste Jean_Marie Marie_Claire Marie_France Marie_Louise Marie_Hélène
Marie_Thérèse Marie_Ange Anne_Sophie Anne_Laure Hans_Peter Karl_Heinz Hans_Jürgen Ana_Clara Maria_Clara
Maria_Eduarda João_Pedro João_Paulo Pedro_Henrique Luiz_Fernando Mei_Ling Wei_Ling Thanh_Huong Minh_Anh Ngoc_Anh
Bao_Anh Thu_Trang Kim_Anh Minh_Tuan Quoc_Bao`;

// Given names that are a title or an office before a name too ("Tuan" Malay "Mr.", "Hakim" a judge or doctor, "Tito"
// Filipino "uncle", "Al" the Arabic "al-"): nothing says which, so never greeted from a full name; typed alone as the name
// they go by they're what they asked to be called (round 20). And one that's an office's letters ("ADA Jordan Ames", an
// assistant district attorney): never greeted from a full name typed all in capitals or all in small letters, where
// nothing says which ("Ada Lovelace", written as a name is, is Ada)
const TITLE_TOO = `Al Hakim Tito Tuan`;
const LETTERS_TOO = `Ada`;
// Given names that are a title before a whole name as often (round 21): "Malik Riaz Hussain" (Malik a Pakistani
// title), "Earl Jordan Ames" (a peer's), "Rana Sanaullah Khan" (a Rajput's), "Sai Mauk Kham" (the Shan "Mr."). Greeted
// only in the plain shape of two words, before a family name alone ("Malik Jones", "Earl Smith"), never with three or more
const TITLE_BEFORE_NAMES = `Malik Earl Rana Sai`;
// A given name that's the first word of a title of two (round 21): Balinese "Ida Bagus" and "Ida Ayu", for a man and a
// woman of the Brahmin caste, before their own name ("Ida Bagus Mantra", "Ida Ayu Putri"): no name from either
const TITLE_PAIRS = `Ida_Bagus Ida_Ayu`;

// Family names that come first. A full name starting with one of these gets no name, even when it's a given name too
const FAMILY_FIRST_NAMES = `Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Gao Lin Luo Zheng Liang
Xie Song Tang Han Feng Deng Cao Peng Zeng Xiao Tian Dong Pan Yuan Cai Jiang Yu Du Ye Cheng Wei Su Lu Ding Ren Shen Yao
Cui Zhong Tan Fan Jin Shi Liao Jia Xia Fu Fang Bai Zou Meng Xiong Qin Qiu Hou Yin Xue Yan Duan Lei Long Tao Gu Mao Hao
Gong Shao Wan Qian Dai Mo Kong Xiang Chang Kang Chi Niu Ou Hong Ge Wen Geng Guan Lan Bao An Zuo Zhan Qi Ning Ji Mei Hui
Ling Fei Hua Xin Chan Cheung Chow Chu Fong Ho Kwan Kwok Lam Lau Leung Lo Mak Ng Siu Tam Tsang Tse Wong Yeung Yip Lai Lee
Choi Chiu Chung Fung Kwong Law Lui Mok Poon Tong Tsui Yau Yuen Chiang Hsu Hsieh Tsai Chuang Kuo Chou Yeh Tseng Shih Kao
Hung Yen Sung Hsiao Tu Ko Teo Ong Goh Lim Tay Koh Chia Quek Yeo Seah Heng Chua Teh Kim Yi Rhee Park Pak Bak Choe Jung
Jeong Cho Jo Yoon Yun Jang Im Oh Shin Sin Kwon Gwon Hwang Ahn Jeon Jun Ko Go Moon Mun Son Bae Baek Paek Heo Hur Yoo Ryu
Nam Noh Roh Ha Kwak Seong Cha Joo Ju Woo Koo Min Na Uhm Eom Chae Won Cheon Bang Hyun Ham Byun Yeom Yeo Choo Do Seok Seo
Suh Seol Gil Pyo Yeon Wi Ki Ban Geum Ok Yook Maeng Je Tak Guk Eo Eun Nguyen Tran Le Pham Hoang Huynh Phan Vu Vo Dang Bui
Ngo Duong Ly Truong Dinh Mai Trinh Luong Cao Ta Kieu Thai Quach Luu Doan Vuong Trieu La Tong Diep Banh Thach Phung Mac
Bach Giang Kha Nghiem Lieu Tieu Ton Chau Tang Vang Xiong Thao Vue Moua Her Lor Hang Khang Kue Pha Lo Thor Yang Chue
Kato Abe Chong Chao Myung`;
// (round 21, the last line: family names written first that the given-names list has too, mainly family names where
// they come from: Japanese Katō and Abe, Korean Chong and Myung, Taiwanese Chao (Wade-Giles for Zhao). The list's other
// words that are family names there too are given names as often: FAMILY_FIRST_BEFORE's, below)

// Family names that come first only before a given name of that people's own (round 21 had Sam and Joe; round 22,
// finding 2, every word on the lists above that's a family name too where the family name is written first, by people:
// the lead overruled round 21's call to leave Yong, Tien, Jen, Ming, Kai, Bo, Ping, Shu and Shan to be greeted). Written
// given name first they're theirs ("Sam Rowe", "Tien Smith", "Kai Jones", "Ming Yao"); before a given name from that
// people's own list they're the family name, and the name gets no name ("Sam Rainsy" is Rainsy of the Sam family, "Tien
// Yu-ting" Yu-ting of the Tien family (Tian in pinyin), "Jen Hsin-yi", "Shan Xiaoming", "Yong Min-jun", "Kai Yuki"). The
// given name after can be a family name too ("Ming Wei", "Joe Min"): nothing then says which comes first, so no name
// either (round 21 greeted "Joe Min"; the lead's rule, round 22, doesn't). Two given names people go by together before a
// family name are a pair, never a family name and a given name ("Thanh Huong Ames" is Thanh Huong: _advisory-form.js)
//   Round 23 (finding 1: "Tung Chih-ming" and "Pao Yu-ting" were greeted "Tung" and "Pao", Wade-Giles and Cantonese for
// Dong and Bao, given names here as Vietnamese and Hmong ones): no longer picked by hand. Each people's own family names,
// as they're usually romanized, are written out below (FAMILY_NAMES_OF), and every one of them that's a given name
// anywhere on the lists, and not a family name that always comes first (FAMILY_FIRST_NAMES), is that people's family name
// before their own given names: the lists build it (build), so a name added to either list is counted without anyone
// remembering to. A test checks it against family names written out apart from these
//   Round 24 (finding 1: Wade-Giles Juan and Jan, for Ruan and Ran, were greeted, being Spanish and Dutch given names too,
// and missing from the Wade-Giles line written by hand): no form picked by hand. Every Chinese family name in pinyin is
// written once (PINYIN_FAMILY), and its Wade-Giles form is made from it by Wade-Giles's own rules (wadeGiles, below: the
// initials and finals as the romanization maps them), and its Hong Kong form read off a table of each name's Cantonese
// reading (CANTONESE_OF, since Cantonese sounds can't be worked out from Mandarin ones): build adds both, so no form of a
// name on the list is missing. A test fails if one isn't known. The lines written by hand below are kept (Taiwan's usual
// spellings, "Hsu" for Hsü; Singapore's and Malaysia's Hokkien and Teochew)
const PINYIN_FAMILY = `Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Gao Lin Luo Zheng Liang Xie Song Tang
Han Feng Deng Cao Peng Zeng Xiao Tian Dong Pan Yuan Cai Jiang Yu Du Ye Cheng Wei Su Lu Ding Ren Shen Yao Cui Zhong Tan Fan
Jin Shi Liao Jia Xia Fu Fang Bai Zou Meng Xiong Qin Qiu Hou Yin Xue Yan Duan Lei Long Tao Gu Mao Hao Gong Shao Wan Qian
Dai Mo Kong Xiang Chang Kang Chi Niu Ou Hong Ge Wen Geng Guan Lan Bao An Zuo Zhan Qi Ning Ji Mei Hui Ling Fei Hua Xin Ying
Jian Zhen Jing Qing Ming Bo Ping Kai Yong Shu Shan Rui Qiang Zhi Lou Jie Hai Kou Min Rong Mu Yue Zhuang Tong Ruan Lian Ai
Huo Pu Qu Bian Hang Shang Gan Dou Sheng Zhai Ni Cen Ke Yun Tu Jun Bi Ban Chai Che Diao Gui Jiao Ju Kan Kuang Lai Lang
Leng Lv Man Miao Nie Nong Pang Pei Qiao Sang Sha She Si Sui Tai Teng Tie Weng Xi Xiu Xuan You Zang Zhuo Zong
Ran Rao Ru Quan Shou Bu Mi Gou Na Nan Chu Xing Mou Ba Bei Huan Lao Le Mai Nian Xian Zha Zu Chao Chong Da Dang Di E Luan Yi
Situ Ouyang Sima Zhuge Shangguan`;
// (each pinyin family name's Hong Kong spellings, from its Cantonese reading, every common character it's written with:
// Li is 李 Lee or Li and 黎 Lai, Wu 吴 Ng and 武 Mo)
const CANTONESE_OF = `Wang:Wong Li:Lee,Li,Lai Zhang:Cheung Liu:Lau Chen:Chan Yang:Yeung Huang:Wong Zhao:Chiu Wu:Ng,Mo Zhou:Chow,Chau
Xu:Tsui,Hui Sun:Suen Ma:Ma Zhu:Chu,Chuk Hu:Wu Guo:Kwok He:Ho Gao:Ko Lin:Lam Luo:Law,Lo,Lok Zheng:Cheng Liang:Leung Xie:Tse
Song:Sung Tang:Tong Han:Hon Feng:Fung Deng:Tang Cao:Cho,Tso Peng:Pang Zeng:Tsang Xiao:Siu Tian:Tin Dong:Tung Pan:Poon
Yuan:Yuen Cai:Choi Jiang:Kong,Keung,Cheung Yu:Yu,Yue,Yee Du:To Ye:Yip Cheng:Ching Wei:Ngai,Wai Su:So Lu:Lo,Lui,Luk Ding:Ting
Ren:Yam Shen:Shum,Sham,San Yao:Yiu Cui:Tsui Zhong:Chung Tan:Tam Fan:Fan Jin:Kam Shi:Shek,Sze Liao:Liu Jia:Ka Xia:Ha Fu:Fu
Fang:Fong Bai:Pak Zou:Chau Meng:Mang Xiong:Hung Qin:Chun Qiu:Yau,Kau Hou:Hau Yin:Wan,Yan Xue:Sit Yan:Yim,Ngan,Yin Duan:Tuen
Lei:Lui Long:Lung Tao:To Gu:Koo,Ku,Kuk Mao:Mo Hao:Kok Gong:Kung Shao:Shiu Wan:Man Qian:Chin Dai:Tai Mo:Mok Kong:Hung
Xiang:Heung,Hong Chang:Sheung Kang:Hong Chi:Chi Niu:Ngau Ou:Au Hong:Hung Ge:Kot Wen:Wan,Man Geng:Kang Guan:Kwan Lan:Lam
Bao:Pau An:On Zuo:Cho Zhan:Chim Qi:Chai,Chik,Kei Ning:Ning Ji:Kei,Kat,Kwai Mei:Mui Hui:Wai Ling:Ling Fei:Fai Hua:Wah
Xin:San Ying:Ying Jian:Kan Zhen:Yan Jing:King Qing:Hing Ming:Ming Bo:Pok,Pak Ping:Ping Kai:Hoi Yong:Yung Shu:Shu
Shan:Sin,Shan Rui:Yui Qiang:Keung Zhi:Chi Lou:Lau Jie:Kai,Kit Hai:Hoi Kou:Kau Min:Man Rong:Yung,Wing Mu:Muk,Mo Yue:Ngok,Lok
Zhuang:Chong Tong:Tung Ruan:Yuen Lian:Lin,Lim Ai:Ngai Huo:Fok Pu:Po,Pok Qu:Wat,Kuk,Kui Bian:Pin Hang:Hong Shang:Sheung
Gan:Kam,Kon Dou:Tau Sheng:Shing Zhai:Chak Ni:Ngai Cen:Shum,Sum Ke:Or Yun:Wan Tu:To Jun:Kwan Bi:Pat Ban:Pan Chai:Chai Che:Che
Diao:Tiu Gui:Kwai Jiao:Chiu Ju:Kuk,Kui Kan:Ham Kuang:Kwong,Hong Lai:Lai,Loi Lang:Long Leng:Lang Lv:Lui Man:Moon,Mun
Miao:Miu,Mau Nie:Nip Nong:Nung Pang:Pong Pei:Pui Qiao:Kiu Sang:Song Sha:Sha She:Shea,Se Si:Sze Sui:Chui Tai:Toi Teng:Tang
Tie:Tit Weng:Yung Xi:Chik,Hai Xiu:Sau Xuan:Suen You:Yau Zang:Chong Zhuo:Cheuk Zong:Chung Ran:Yim Rao:Yiu Ru:Yu
Quan:Kuen,Chuen Shou:Sau Bu:Pok Mi:Mai Gou:Kau Na:Na Nan:Nam Chu:Chu,Chor Xing:Ying Mou:Mau Ba:Pa Bei:Pui Huan:Woon Lao:Lo
Le:Lok Mai:Mak Nian:Nin Xian:Sin Zha:Cha Zu:Cho Chao:Chau Chong:Sung Da:Tat Dang:Tong Di:Tik,Tai E:Ngok Luan:Luen Yi:Yik,Yee
Situ:Szeto Ouyang:Auyeung,Au-Yeung Sima:Szema Zhuge:Chukot Shangguan:Sheungkoon`;
// Round 25 (finding 3: "Soo Wei Ming" was greeted "Soo", Soo being how Malaysia and Singapore write 苏, Su, as Hakka says
// it): Singapore's and Malaysia's spellings made by rule, as the Wade-Giles ones are. Each pinyin family name's readings, as
// Hokkien, Teochew, Cantonese, Hakka and Hainanese say it (pinyin:hokkien/teochew/cantonese/hakka/hainanese, each written
// plainly, a reading of more than one a comma between: 苏 is so in Hokkien, su in Hakka), and straitsSpellings writes each
// reading the ways Singapore and Malaysia spell it (a last u as u or oo, "Su", "Soo"; a last i as i or ee, "Li", "Lee"; a
// last o as o or oh, "Go", "Goh"...). No spelling is picked by hand: the readings are written, the rule spells them. A
// test fails if a family name common there has none
const STRAITS_OF = `Chen:tan,tng/tang,tan/chan/chin/tan Lin:lim/lim/lam,lum/lim/lim Huang:ng,ooi,wee,ung/ng,ung,wee/wong/wong,vong/wee,ng
Li:li/li/li,lei/li/li Zhang:teo,tiu,chang/teo,tio/cheung,cheong/chong,chang,jong/chong,tiong Wu:go,ngo/ng,go/ng/ng/ng,go
Wang:ong/heng,ong/wong/wong,vong/ong Liu:lau/lau/lau/liu/lau Yang:yeo,iu,yong/yeo,yong/yeung,yong/yong,yeong/yeo
Guo:kwek,kuek,koay/kwek,kuek/kwok/kok,kwok/ko Xu:kho,khaw,chi,ser/kho,chi/hui,tsui,chui/hi,hee,chi,chooi/kho,chi
Zeng:chan,cheng/chang/tsang,chang/chen,tsen/chang Cai:chua/chua/choi,choy/chai,choy/chua
Xie:chia,sia/chia,sia/tse/chia,cha/chia Liang:neo,nio,leong/neo,nio/leung,leong/liong,leong/leong
Zheng:tay,te,ti/tay,te/cheng,chang/chang,cheng/te Su:so,saw/so/so/su/so He:ho,hoe/ho/ho/ho/ho Luo:lo/lo/law,lo,lok/lo/lo
Ye:yap,yeap,iap/yap/ip,yip/yap,yip/yap Qiu:khu,khoo/khu/yau/hiu,khiu/khu Hu:o,oh,aw/o,hu/wu/fu,voo/fu
Zhu:chu/chu/chu,chue/chu/chu Gao:ko/kao,ko/ko,kou/ko,kow/ko Ke:kua,kwa/kua/or/ko/kua Fu:po,hu/po/fu/fu/phu,hu
Pan:phua,phoa/phua/poon,pun/phan,pan/phua Zhong:cheng,chiong/cheng/chung,cheong/chong/chong Lai:lua,lai/lua,nai/lai/lai/lai
Sun:sng,soon/sng/suen,sun/soon,sun/sun Ma:be/be/ma/ma/ma Fang:png,hong/png,hng/fong/fong/fong Hong:ang/ang/hung/fung/ang
Zhuang:chng/chng/chong/chong/chng Yu:ee,u/ee/yu,yee,yue/yee,ee/ee Lu:lo,loo,liok/lo,liok/lo,lou,luk/lu,liuk/lu,liok
Shen:sim/sim/shum,sum,sam/sim,shim/sim Shi:si,chioh/si/shek,sze/si/si Wei:gwee,gui/ngui/ngai/ngui/gwee
Yao:yeo,iau/iau/yiu/yau/iau Liao:liau/liau/liu/liau/liau Jiang:kang,chiang/kang,chiang/kong,cheung/kong,chiong/kang,chiang
Yan:gan,giam,ngiam/ngan,giam/ngan,yim/ngan/gan Peng:phe,phee/phe/pang/phang/phe Feng:pang/pang/fung/fung/pang
Song:song/song/sung/sung/song Deng:teng,tng/teng/tang/then,tang/teng Han:han/han/hon/hon/han Gu:ko/ko/ku/ku/ko
Wen:bun,woon/bun/wan,man,mun/voon,vun,woon/bun Tian:tian,chan/tian/tin/thien/tian Ou:au,ow,aw/au/au/au/au
Mo:bok,mok/bok/mok/mok/mok Dai:te,tay/te/tai/tai/tai Dong:tang,tong/tang/tung/tung,thung/tang Xiao:siau/siau/siu/siau/siau
Zhou:chiu/chiu/chow,chau/chiu/chiu Jin:kim/kim/kam,kum/kim/kim Gan:kam/kam/kam,kum/kam/kam Kong:khong/khong/hung/khung/khong
Bai:peh,pek/peh/pak/phak/peh Fan:huan/huam/fan/fam/huan Tang:tng,thng,tong/tng/tong/thong/tong
Tan:tham/tham/tam/tham,thum/tham Yuan:oan,wan/oan/yuen/yen/oan Weng:ang,ong/ang/yung/vung/ang Tu:too/too/to/tu/too
You:iu,yu/iu/yau/yu/iu Du:to,too/to/to,tou/tu/to Zhuo:toh,tok,to/toh,to/cheuk/chok/tok,to Xian://sin/sien/
Jian:kan/kan/kan/kan/kan Xue:sih,sit/sih/sit/siet/sih Cao:cho,chow/cho/cho,tso/tsho/cho Lian:lian/lian/lin/lien/lian
Che:chia/chia/che/cha/chia Lan:lam/lam/lam/lam/lam Lei:lui/lui/lui,loi/lui/lui Kuang:khong/khong/kwong/khong/khong
Yun:hun/hun/wan/yun/hoon,woon Zhan:chiam/chiam/chim/cham/chiam Mei:boey,moey,mui/mui/mui/moi/mui Hou:hau,kau/hau/hau/heu/hau
Cheng:teng,thia/theng/ching/chang/teng Qian:chee,chian/chian/chin/chien/chian Zou:chau/chau/chau/cheu/chau
Ruan:ng/ng/yuen/ngion/ng Lv:lu,ler/lu/lui/li/lu Ding:teng,ting/teng/ting/ten/teng Ren://yam/yim/
Kang:khng,kang/khang/hong/khong/khang Yi:ek/ek/yik/yit/ek Xing:heng/heng/ying/hin/hing Ning:leng/leng/ning/nen/leng
Gong:keng,kiong/keng/kung/kiung/keng Mai:beh/beh/mak/mak/beh Mao:mo,mau/mo/mo/mau/mo Tao:to/to/to/thau/to
Pang:pang/pang/pong/pong/pang Xia:he/he/ha/ha/he Jia:ka/ka/ka/ka/ka Huo:hok/hok/fok/fok/hok Qi:chee,ki/chee/chai,chik/chi/chee
Rao:jiau/jiau/yiu/ngiau/jiau Shao:sio/sio/shiu/seu/sio Xiong:him/him/hung/hiung/him Ni:geh,ngee/ngee/ngai/ngi/geh
Tong:tang/tang/tung/thung/tang Situ:suto/suto/szeto/sutu/suto Ouyang:auyong/auyong/auyeung/euyong/auyong Guan:kuan/kuan/kwan/kuan/kuan Rong:eng/eng/wing,yung/yung/eng Ji:ki/ki/kei,kat/ki/ki`;
// (the ways Singapore and Malaysia spell a reading, by the spelling's own rules: a last u, u or oo, "Soo", "Khoo", "Foo";
// a last i, i or ee, "Lee", "Chee", "Tee"; a last o, o or oh, and or after h, k or l, "Goh", "Teoh", "Hor", "Lor"; a last
// e, e, eh or ey, "Teh", "Beh", "Tey"; a last ia, ia or eah, "Cheah", "Seah"; a last iu, iu, iew or ew, "Liew", "Chew"; a last
// iau, iau, iaw, eow or iow, "Liaw", "Seow"; a last au or ou, ow too, "Low", "Chow", "Tow"; a last a, ah too, "Mah"; a last
// ua, uah too, "Chuah"; a last ong after ch, f, l, t or y, oong too, "Choong", "Foong"; a last ok, oke too, "Loke"; a first
// kw, qu too, "Quek"; a first ph or kh, its h dropped too, "Pua", "Kiew")
// (its first letters' rules first, then its last letters', each once: "khiu" is "kiu", and so "Kiew"; written as plain
// string steps, so the few hundred readings are spelt at once)
const straitsSpellings = (r) => {
  const firsts = [r];
  if (r.startsWith('kw')) firsts.push(`qu${r.slice(2)}`);
  else if (r.startsWith('ph') || r.startsWith('kh')) firsts.push(r[0] + r.slice(2));
  const out = new Set(firsts);
  for (const f of firsts) {
    const n = f.length;
    const [x, y, z] = [f[n - 3] || '', f[n - 2] || '', f[n - 1]];
    const cut = (k, ...tos) => { for (const t of tos) out.add(f.slice(0, n - k) + t); };
    const after = (k) => !!f[n - 1 - k] && !'aeiou'.includes(f[n - 1 - k]);
    if (z === 'u' && after(1)) cut(1, 'oo');
    if (z === 'i' && after(1)) cut(1, 'ee');
    if (z === 'o' && y && y !== 'o') { cut(0, 'h'); if ('hkl'.includes(y)) cut(1, 'or'); }
    if (z === 'e' && /^(?:b|p|t|ch|h|k|l|m|n|s|g)e$/.test(f)) { cut(0, 'h'); cut(1, 'ey'); }
    if (z === 'a' && after(1)) cut(0, 'h');
    if (y + z === 'ia' && after(2)) cut(2, 'eah');
    if (y + z === 'iu' && after(2)) cut(2, 'iew', 'ew');
    if (x + y + z === 'iau') cut(3, 'iaw', 'iow', 'eow');
    else if (y + z === 'au') cut(2, 'ow');
    if (y + z === 'ou') cut(2, 'ow');
    if (y + z === 'ua' && after(2)) cut(0, 'h');
    if (/(?:ch|f|l|t|y)ong$/.test(f)) cut(3, 'oong');
    if (y + z === 'ok') cut(0, 'e');
  }
  return [...out];
};
const FAMILY_NAMES_OF = [
  // (Chinese: pinyin, PINYIN_FAMILY above, its Wade-Giles and Hong Kong forms made from it in build; Taiwan's usual
  // Wade-Giles spellings; Cantonese, as Hong Kong and Macau write them; Hokkien and Teochew, as Singapore, Malaysia and the
  // Philippines write them)
  [CHINESE, `Chang Chen Hsu Tsai Cheng Hsieh Kuo Hung Tseng Chiu Chou Yeh Chuang Chiang Ho Kao Lo Chien Chung Tsao Tien Ting Ku Chu
  Teng Jen Shih Chao Sung Kuan Yen Hsiao Pai Chin Kung Tsui Hsueh Lung Chia Tung Tuan Tso Tsou Pi Pao Hsiung Yung Hsing
  Hsia Ching Chuan Kuang Chan Cheung Chow Fong Kwan Kwok Lam Lau Leung Mak Ng Siu Tam Tsang Tse Wong Yeung Yip Choi Fung
  Kwong Law Lui Mok Poon Yau Yuen Yim Yiu Kam Shum Sham Szeto Au Chau Chong Chuk Fok Hau Hon Ip Kei Keung Lok Lum Mui Ngai
  Pak Pun Shek Sin So Tin To Tsoi Wai Wing Yam Yee Yuk Kwai Tan Lim Ong Goh Chua Teo Koh Tay Yeo Seah Heng Quek Toh Ang Sim
  Low Poh Soh Tee Yap Liew Foo Kwek Teh Loh Yeoh Khoo Cheah Beh Kok Lee Ooi Oei Sia Go Khaw Tio Wee`],
  // (Japanese)
  [JAPANESE, `Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Yamaguchi
  Matsumoto Inoue Kimura Hayashi Shimizu Yamazaki Mori Abe Ikeda Hashimoto Yamashita Ishikawa Nakajima Maeda Fujita Ogawa
  Goto Okada Hasegawa Murakami Kondo Ishii Saito Sakamoto Endo Aoki Fujii Nishimura Fukuda Ota Miura Fujiwara Okamoto
  Matsuda Nakagawa Nakano Harada Ono Tamura Takeuchi Kaneko Wada Nakayama Ishida Ueda Morita Hara Shibata Sakai Kudo
  Yokoyama Miyazaki Miyamoto Uchida Takagi Ando Taniguchi Ohno Maruyama Imai Takada Fujimoto Takeda Murata Ueno Sugiyama
  Masuda Sugawara Hirano Kojima Otsuka Chiba Kubo Matsui Iwasaki Sakurai Kinoshita Noguchi Matsuo Nomura Kikuchi Sano
  Onishi Sugimoto Arai Hamada Ichikawa Furukawa Mizuno Komatsu Shimada Koyama Takano Yamauchi Nishida Kawano Kawasaki Honda
  Noda Oda Seki Tani Toda Yano Hoshino Kumagai Mochizuki Hino Kono Naka Shima Mita Ohta Nishi Arakawa Kawai Sone Taira
  Shiba Sugi Hata Nara Mine Kaji Asano Imamura Oka Hori Kanda Kubota Hirata Kitamura Matsushita Okubo Morimoto Tsuchiya
  Ogata Kawaguchi Kishi Doi Jo Mano Kai Yuki Aida Miki Sakura Ken Rin Hiro Ike Mai
  Iida Iwata Kaneda Oshima Amano Ogura Kuroda Hirai Nagai Nishikawa Kitagawa Takayama Yoshikawa Hattori Ishihara Sugita Kuwahara
  Nagata Hayashida Matsuura Morioka Okabe Okazaki Shimada Takemoto Uchiyama Yamane Yasuda Yokota Aoyama Ichihara Ishizaki Kamata
  Kanai Kawamura Kawashima Kojima Kumamoto Maruta Mizutani Nakata Nakazawa Nishiyama Ohashi Okuda Sasaki Shibuya Tsuda Wakabayashi`],
  // (Korean, in the spellings Korean Americans use)
  [KOREAN, `Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Jeon Hong Yoo Ko Moon Yang Son
  Bae Baek Heo Nam Shim Noh Ha Kwak Sung Cha Joo Woo Koo Min Ryu Na Jin Ji Uhm Chae Won Chun Bang Gong Hyun Ham Byun Yeom
  Yeo Choo Do Seok Sun Seol Ma Gil Pyo Yeon Wi Ki Ban Wang Geum Ok Yook In Maeng Je Mo Tak Kook Eo Eun Pyeon Yong Ye Kyung
  Bong Sa Bu Sim Lyu Rhee Yi Rho Roh Suh Hahn Paik Pak Chung Chang Chong Cheong Kong Hur Yu Im Ryoo Moh Myung Joe Gi Jee
  Jeong Jun Ku Gu Kye Shon Sohn Tae Chi Hyeon Seung Jo Seong Cheon Choe Paek Hyon Ann Kil Pi Bok Gan Gook Ryoo`],
  // (Vietnamese: the usual hundred, Thành, Vĩnh, Trang, Lục, Hoa, Quang and Tiền among them)
  [VIETNAMESE, `Nguyen Tran Le Pham Hoang Huynh Phan Vu Vo Dang Bui Do Ho Ngo Duong Ly Truong Dinh Mai Trinh Luong Cao Ta
  Kieu Thai Quach Luu Doan Vuong Trieu La Tong Diep Banh Thach Phung Mac Bach Giang Kha Nghiem Lieu Tieu Ton Chau Tang Lam
  Quan Dao Au Vi Ung Lac Kim Hua Lai Han Ninh Khuc Chu Mach Lu Hau Ong Dam Tat To Tham Than Nong Luc Thanh Vinh Hoa Quang
  Trang Tien Hong Phi Nhan Giap Manh Cu Long Lang Mau Thieu Uong Khong Lo`],
  // (Cambodian. Round 25, finding 3: "Lon Sokha" was greeted "Lon", the family name Lon missing: written out more
  // completely, the last lines)
  [KHMER, `Sam Chea Sok Keo Kim Chan Heng Meas Chhim Pen Hun Sar Tep Chhay Prak Ouk Mao Seng Yim Ly Hor Lim Tan Phan Long
  Nhem Kong Kang Ung Pich Phal Em Nou Chhun Kheang Mam Nuon Sim Som Sun Uy Var Voeun Ros Mey Sin San Seang Touch Ek Kheng
  Pok Nhim Thach Chhin Ngin Chum Om Hang Cheng Chhuon Chhem Huot Oum Prum Chhoeun Sou Duong Yin Mak Lay Hok Tith Sorn Meng
  Thong Nget Phon Chen Vann Vong Chhorn Khim Sem
  Lon Nhek Hem Ngov Ngoun Nuth Pang Phy Rath Roth Sao Soth Suon Thy Yos Dy Hak Ith Khiev Leng Lun Pech Pov Chuon Hean Sath
  Teng Tong Vuth Hing Chhit Neang Oung Kao Eang Ear Aun Chhuy Ieng Kann Kea Khun Leang Muth Neth Noun Path Pheng Prom Reth
  Roeun Seak Soun Thim Toch Tuy Yem Iv Khem Khuon Moeun Kuy Hul Nhean Chann Chim Svay Tuon Yoeun Dith Kheav Chhoun Mech
  Nob Phat Mom Seak Lok Sak Sen Tat`],
  // (Hmong, as written in the US and in Hmong)
  [HMONG, `Vang Xiong Thao Lee Yang Her Moua Lor Hang Khang Kue Pha Lo Thor Chue Chang Vue Cha Fang Hawj Muas Vaj Xyooj Yaj
  Lis Tsab Thoj Kong Kha Koua`],
];

// Round 24 (finding 3): the shape of a given name of the peoples who write the family name first, from each romanization's
// own syllables, so a common given name missing from the lists is still known for one (built in build, never at load).
// Pinyin: each group of initials with the finals it takes ("" the syllables with no initial, y and w written as pinyin
// writes them; ü written v, and u after j, q, x and y)
const PINYIN_TAKES = `b p m:a o ai ei ao an en ang eng i ie iao ian in ing u
m:e ou iu
p:ou
f:a o ei an en ang eng ou u
d t:a e ai ei ao ou an en ang eng ong i ie iao iu ian ing u uo ui uan un
d:ia
n l:a e ai ei ao ou an en ang eng ong i ie iao iu ian in iang ing u uo uan un v ve
l:ia o
g k h zh ch sh r:a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang
zh ch sh r z c s:i
z c s:a e ai ei ao ou an en ang eng ong u uo ui uan un
j q x:i ia ie iao iu ian in iang ing iong u ue uan un
:a o e ai ei ao ou an en ang eng er yi ya ye yao you yan yin yang ying yong yu yue yuan yun wu wa wo wai wei wan wen wang weng`;
// Wade-Giles from a pinyin syllable, by its rules (apostrophes and marks as nameKey drops them: ch'ü is chu, ê is e)
const WG_INITIAL = { b: 'p', p: 'p', d: 't', t: 't', g: 'k', k: 'k', j: 'ch', q: 'ch', x: 'hs', zh: 'ch', ch: 'ch', r: 'j', z: 'ts', c: 'ts' };
const WG_ALONE = { yi: 'i', ye: 'yeh', yan: 'yen', yong: 'yung', you: 'yu', yue: 'yueh', e: 'o', er: 'erh' };
const wgSyllable = (s) => {
  if (/^[yw]/.test(s) || /^(?:a|o|e|ai|ei|ao|ou|an|en|ang|eng|er)$/.test(s)) return WG_ALONE[s] || s;
  const ini = (s.match(/^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcs])/) || [''])[0];
  let fin = s.slice(ini.length);
  const to = WG_INITIAL[ini] ?? ini;
  if (fin === 'i' && 'zcs'.includes(ini)) return ini === 's' ? 'ssu' : 'tzu';
  if (fin === 'i' && ['zh', 'ch', 'sh', 'r'].includes(ini)) return `${to}ih`;
  if (fin === 'ong') fin = 'ung'; else if (fin === 'iong') fin = 'iung'; else if (fin === 'ian') fin = 'ien'; else if (fin === 'ie') fin = 'ieh';
  else if (fin === 'ue' || fin === 've') fin = 'ueh'; else if (fin === 'v') fin = 'u'; else if (fin === 'e' && 'gkh'.includes(ini)) fin = 'o';
  else if (fin === 'uo' && !['g', 'k', 'h', 'sh'].includes(ini)) fin = 'o'; else if (fin === 'ui' && 'gk'.includes(ini)) fin = 'uei';
  return to + fin;
};
// Hong Kong's Cantonese spellings: its initials, each with the finals of its spelling ("ee", "oo", "eung", "uen" as
// Hong Kong writes them, "eong" as Macau and Malaysia do), and the syllables written apart (Ng, Tsz, Sze, the y- and w- ones)
const HK_INITIALS = `ch f h k kw l m n ng p s sh t ts`;
const HK_FINALS = `a ai au am an ang ap at ak ei e eng ek i ee im in ing ip it ik iu o oi on ong ok oo ou u ui un ung uk ut oon eung euk eui eun
  ue uen uet or oh ah eong`;
const HK_ALONE = `a ah ai au am an ang ak o oi on ong ok ou or ng m tsz sze ip yau yan yin ying yip yiu yu yue yuen yuet yuk yung yee yi yik
  yim yeung ya yat wa wah wai wan wang wat wing wo wong wu wui wun oi`;
// Round 24 (the lead, after the first pass): Hokkien, Teochew and Hakka as Singapore and Malaysia write them ("Boon Hock",
// "Kiat", "Siew", "Hwee", "Fook"), each initial with the finals of that spelling, and the older spellings still seen
// ("Chee-hwa", "Yat-sen", "Ying-jeou")
const HOKKIEN_INITIALS = `b ch f g h j k kh l m n ng p ph s t th ts y w`;
const HOKKIEN_FINALS = `a ah ai ak an ang ap at au e eh ek eng ee i ia iah iak iam ian iang iap iat iau iew im in ing ip it iu o oh oi ok om on ong oo
  ooi oon ou u ua uah uan uang uat uay ue ui un ut ock eck ew eok eong eow wee wa wah ye ay oey oay ook iong ien iun oong`;
const HOKKIEN_ALONE = `a ah ai an ang au eng ing ong oon oo ooi oh ew ee hwa jeou sen yat`;
// Korean given names: the syllables they're made of, in the spellings Korean Americans use (Revised Romanization, the older
// spellings and the usual ones: Seong, Sung and Song; Jun and Joon). Two of them, joined or hyphenated, are a name's shape
//   Round 25 (finding 1: "Ann Hye-kyo", "Joe Bum-soo", "Ann Jun-pyo" fit no shape, 48 of the tester's 234 syllables being
// missing): every syllable the romanizations make, by their own rules (KO_INITIALS, KO_VOWELS and KO_FINALS below: Revised
// Romanization's and McCune-Reischauer's initials, vowels and finals, McCune-Reischauer's marks and apostrophes dropped as
// nameKey drops them, and the spellings Korean Americans use for a vowel: eo as o or u, "Song", "Bum"; yeo as yo, yu or you,
// "Byul", "Young"; u as oo, "Joong"; eu as u, "Un"; i as ee), so kyo, pyo, seol, geun, byul, bi and sub are there by rule.
// The written list below is kept, every one of its spellings made by the rule too but for a few of its own ("wook", "shik")
const KO_INITIALS = `- g k kk n d t tt r l m b p pp s ss sh j ch jj tch h`;
const KO_VOWELS = `a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i|eo:o u|yeo:yo yu you|u:oo|eu:u|i:ee|ui:eui|yu:yoo|oe:we`;
const KO_FINALS = `- k g n t d l m p b ng`;
// (the initials, vowels with the spellings people use for them, and finals, '-' none)
const koreanParts = () => {
  const [plainVowels, ...spelt] = KO_VOWELS.split('|');
  const vowels = new Set(words(plainVowels));
  for (const v of spelt) { const [from, to] = v.split(':'); if (vowels.has(from)) for (const t of words(to)) vowels.add(t); }
  const none = (xs) => words(xs).map((x) => (x === '-' ? '' : x));
  return { initials: none(KO_INITIALS), vowels, finals: none(KO_FINALS) };
};
const KOREAN_SYLLABLES = `a ah ae an bae beom bin bit bo bok bom bong byeol byeong byung cha chae chan chang cheol chul chol cheon chun
  cheong chung chi chil da dae dam dan do dong doo du deok duk eon eun eui ui ga gang geon gun gi gil gwang gyu gyeong gook guk geum ha
  hae hak han hee hui heon heung ho hong hoon hun hwa hwan hwi hye hyang hyeok hyuk hyeon hyun hyon hyo il in ja jae jang je jeong jung
  jong ji jin jo joo ju jun joon ka kang keon kun ki kil kwang kyu kyung kyeong kyong kook mi min myeong myung myong mo moon mun na nam
  nan neul ok pil ra rae ram ran ri rim rin ryeong ryung ryun ryul sa sae sang se seo seok suk sook seon sun sung seong song seul si
  shi sik shik shin sin so soo su soon seung seop sup tae taek tak u uk wook woong won woo wan ya yang ye yeo yeon yon youn yong yeong young yoo yu
  yoon yun yul yeol hyung hyeong moo`;
// Japanese given names: two Hepburn morae or more (each consonant with its vowels as Hepburn writes them, the yōon, the
// moraic n and a doubled consonant; a long o written "oh")
const HEPBURN = `a i u e o|k g n b p m r:a i u e o|h:a i e o|s z:a u e o|t d:a e o|sh ch j:a i u o|ts:u|f:u|y:a u o|w:a o|ky gy ny hy by py my ry:a u o`;
// Round 24 (the lead, after the first pass: "Juan Luna", "Ken Johnson", "Aida Romero" lost their greeting to a shape): a
// known family name beats a shape. Common family names of every people here, written out (US and English, African
// American, Hispanic, and others'); one after a family name written first that isn't on that people's own given-name list
// is the family name, so the first word is the given name, as "Kai Chen" and "Yuki Kato" are. Split when first asked
const SURNAMES = [
  `smith johnson williams brown jones miller davis wilson anderson thomas taylor moore jackson martin thompson white harris
  clark lewis robinson walker young allen king wright scott hill green adams nelson baker hall campbell mitchell carter roberts
  phillips evans turner parker edwards collins stewart morris murphy cook rogers morgan cooper peterson bailey reed kelly howard
  cox ward richardson watson brooks wood james bennett gray hughes price sanders myers long ross foster powell jenkins perry
  russell sullivan bell coleman butler henderson barnes fisher simmons jordan patterson alexander hamilton graham reynolds
  griffin wallace west cole hayes bryant gibson ellis stevens murray ford marshall owens harrison mcdonald woods washington
  kennedy wells freeman webb tucker burns crawford olson simpson porter hunter gordon shaw snyder mason dixon hunt hicks holmes
  palmer wagner black robertson boyd rose stone fox warren mills meyer rice schmidt daniels ferguson nichols stephens weaver
  ryan gardner payne grant dunn kelley spencer hawkins arnold pierce hansen peters hart bradley knight elliott cunningham
  duncan armstrong hudson carroll lane riley andrews ray berry perkins hoffman johnston matthews richards willis carpenter
  lawrence chapman watkins greene wheeler harper burke larson morrison franklin carlson austin carr lawson jacobs obrien
  lynch bishop montgomery oliver jensen harvey williamson gilbert dean sims howell reid hanson mccoy garrett burton fuller
  weber welch lucas fields little banks day walsh bowman schultz fowler brewer may holland newman pearson curtis douglas
  schneider joseph barrett hopkins barnett bates chambers caldwell beck lambert byrd craig lowe frazier powers neal leonard
  pratt barker mann hale moran dale kane tate pace gage shea bale hanna wade stanley bowen`,
  // (the next most common in the US, after the first few hundred. Round 25: Tran and Wong, common here too, are left out,
  // being family names of peoples who write the family name first, never evidence of the order: familyFirstUnsure)
  `abbott acker adkins aldridge allison ambrose andrade ashby atkins atwood ayers babcock bader bagley baird baldwin ballard
  banner barber barlow barr barton bass battle baxter beard beasley benson bentley berger bernard best bird blackburn blackwell
  blair blake blankenship blevins bolton bond booker boone booth bowers boyer boyle bradford bradshaw brady brandt bray bridges
  briggs brock bryan buchanan buck buckley bullock burch burgess burnett bush cain calderon calhoun callahan cameron cannon
  cantrell carey carmichael carney carson carver case cash castaneda chandler chaney childers christensen church clay clayton
  cline cobb cochran coffey cohen collier combs compton conley conner conrad conway copeland corbett cotton cowan crane
  crosby cross cummings curry dalton daniel darby daugherty davenport david davidson dawson decker dennis dickerson dillard
  dillon dodson donovan dorsey downs doyle drake dudley duffy dugan duke durham dyer eaton emerson english erickson estes
  everett farley farmer farrell faulkner finch finley fitch fleming flynn floyd forbes ford foreman frank frederick french
  frost fry frye gaines galloway gamble garner garrison gates gentry gill glass glenn glover golden goodman goodwin gough gould
  graves gregory griffith grimes gross hahn hammond hancock haney hardin hardy harmon harrell hatcher hayden haynes hebert
  hendrix hensley herman hess hester hinton hobbs hodge hodges hogan holder holland holloway holt hooper hoover hopper horn
  horne horton house houston huber huff huffman humphrey hurley hurst hutchinson hyde ingram irwin jacobson james jarvis
  jefferson jennings johns kaufman keith keller kemp kent kerr key kidd kirby kirk kline knapp knox koch kramer lamb landry
  langley lara leach lindsay lindsey little livingston logan love lowery lucero luna lyons mack maddox mahoney malone mann
  marks marsh massey mathews maxwell mayer maynard mays mcbride mccall mccann mcclain mcconnell mccormick mccullough mcdaniel
  mcgee mcguire mcintosh mckay mckee mckinney mclaughlin mcmahon mcpherson meadows medina melton mercer merritt meyers middleton
  miles miller monroe moody moon mooney mora morrow moses moss mueller mullins nash newton noble nolan norman norris norton
  odom oneal oneill osborne pate patrick patton paul pearce peck pennington pittman pollard poole pope potter preston
  pruitt quinn rankin ratliff reese reeves rhodes rich riddle roach robbins rocha rollins roman rosario roth rowe rowland
  rush sampson saunders savage sawyer schroeder sexton sharp shelton shepherd sheppard short skinner slater sloan small
  solomon sparks stafford stark steele stephenson stokes stout strickland summers sutton swanson sweeney talley tanner
  terrell terry todd toro townsend travis tyler underwood vance vaughan vaughn velazquez vincent walls walter walton
  ware waters watts weeks whitaker whitehead whitley wiggins wilcox wilder wiley wilkerson wilkins winters wise wolfe
  workman wyatt yates york zimmer zimmerman`,
  // (Hispanic and Latino, Portuguese and Brazilian, Filipino)
  `garcia rodriguez martinez hernandez lopez gonzalez perez sanchez ramirez torres flores rivera gomez diaz cruz reyes morales
  gutierrez ortiz ramos chavez mendoza ruiz alvarez castillo jimenez moreno romero herrera medina aguilar vargas castro
  guzman mendez salazar soto delgado pena rios estrada ortega contreras sandoval guerrero santiago maldonado dominguez vega
  espinoza marquez luna padilla mejia juarez figueroa navarro campos avila molina miranda ayala acosta cortez rosales
  fuentes cabrera escobar pacheco valencia ibarra vasquez vazquez nunez munoz alvarado valdez gonzales sosa velasquez
  carrillo cervantes rojas franco serrano trujillo salinas montoya bautista santos silva oliveira souza pereira costa
  ferreira almeida carvalho lima ribeiro barbosa rocha dias nascimento araujo monteiro mendes cardoso teixeira correia
  pinto moura cavalcanti machado vieira medeiros fonseca villanueva mercado aquino dela delos manalo mendiola tolentino
  fernandez velez colon acevedo cordero orozco zamora barajas villarreal duran galvan arellano solis gallegos lozano
  ochoa beltran sierra rubio pineda leon montes cisneros robles bonilla valenzuela prado escamilla zuniga`,
  // (European: Italian, German, Dutch, Polish, Irish and Scottish, French, Greek, Russian and Ukrainian, Jewish)
  `rossi russo ferrari esposito bianchi romano colombo ricci marino greco bruno gallo conti deluca costa giordano mancini
  rizzo lombardi moretti barbieri fontana santoro mariani rinaldi caruso ferrara galli martini leone longo gentile martinelli
  vitale serra coppola desantis fabbri muller mueller schmitt schneider fischer meyer weber schulz becker hoffmann schafer
  koch bauer richter klein wolf schroeder neumann schwarz zimmermann braun kruger hartmann lange werner krause lehmann kohler
  dejong devries vandenberg bakker janssen visser smit meijer mulder bos vos dekker nowak kowalski wisniewski wojcik
  kowalczyk kaminski lewandowski zielinski szymanski wozniak dabrowski kozlowski jankowski mazur kwiatkowski krawczyk
  murphy kelly obrien byrne ryan walsh oconnor mccarthy doyle gallagher kennedy lynch quinn moran dunne brennan burke
  mcdonnell fitzgerald macdonald campbell stewart mackenzie fraser mclean martin bernard dubois durand lefebvre leroy moreau
  laurent michel garnier faure rousseau blanc guerin muller fournier girard bonnet dupont lambert fontaine chevalier
  papadopoulos georgiou nikolaou ivanov smirnov kuznetsov popov petrov sokolov volkov kozlov novikov morozov pavlov
  shevchenko kovalenko bondarenko kravchenko cohen levy levine katz goldberg friedman shapiro rosen stein klein weiss
  kaplan schwartz feldman greenberg horowitz rubin abrams`,
  // (South Asian, Arabic and Persian, Turkish, African, Caribbean)
  `patel shah singh kumar sharma gupta mehta joshi desai reddy rao iyer nair menon pillai chatterjee banerjee mukherjee das
  bose sen ghosh khan ahmed hussain rahman chowdhury hossain islam siddiqui qureshi malik akhtar sheikh mirza ansari
  haddad khoury nasser saleh mansour hamdan darwish abboud karimi hosseini mohammadi rahimi ahmadi yilmaz kaya demir
  sahin celik yildiz aydin ozturk okafor okeke okonkwo eze nwosu adeyemi adebayo ogunleye balogun mensah asante owusu boateng
  appiah osei acheampong tesfaye bekele girma haile alemu kebede wolde diallo traore ndiaye diop toure kamara jean pierre
  joseph louis charles baptiste etienne francois laguerre desir saintil campbell brown`,
  // (round 25, finding 1's rule: the lists grown from their own sources, written out by hand. More US, English, Scottish,
  // Irish and Welsh; Lee, an English family name too; the countries that are common family names, England,
  // Israel, Ireland, Wales, Portugal, Montenegro, Trinidad; and family names ending in -ne after a man's given name, never a
  // Hungarian wife's name by her husband's, finding 4: Thorne, Rayne, Wynne)
  `lee england israel ireland wales portugal montenegro trinidad starbuck thorne rayne raine wynne browne milne bourne ronne ames quill doe henry george anthony arthur francis abernathy ackerman adair adcock adler agnew aiken akin akins albright
  alcorn alder aldrich alford allard allred alston amos anders andersen andrus appleby arden armour arnett ashford ashley
  ashworth atherton atkinson avery aycock ayres bachman backus bagwell bales ballew bancroft barclay barfield barnhart
  barnhill barksdale barlowe barnard barnum barron barrow barry bartholomew barnwell bassett batchelor bauman baumgartner
  beale beals beane beaty beaver beckett beckman beckwith bedford beebe belcher belk bellamy belton benefield benjamin
  bennet berg bergman berman bertram betts bevins bickford biggs billings bingham birch bivens blackman blackmon blackwood
  blaine blakely blalock blanchard bland bledsoe bloom blount blue blum boatwright bobo boggs bolden boles bolin bolling
  bonds borden boswell bourne bowden bowie bowles bowling bowser boyce boykin bracken bradberry bradbury bragg branch brand
  brandon brannon branson brantley brashear braswell brewster brice bridgewater bright brinkley briscoe britt britton
  broadus brody bronson brookins broome broussard browder browning broyles bruce brumfield bryson buckner buford bullard
  bumgarner bundy bunting burdette burkett burkhart burleson burley burnham burr burrell burris burroughs burrows burt
  bussey butcher byers bynum cabe cagle cahill callaway calloway calvert camp candler canty caraway carden cardwell carlisle
  carlton carmack carrington carrol cartwright casey cassidy castle cates causey cavanaugh chaffin chalmers chamberlain
  chambliss champion chancellor chapin chappell chase cheek cheney cherry chesser chester childress childs chisholm
  christian christie christopher churchill clancy clapp clardy clarke claxton cleary clem clement clements clemmons clemons
  clinton cloud coates coats coble cockrell cody coffman cogburn coggins coker colby coley colvin comer conklin connell
  connelly connolly connor conyers coogan cooke cooley coomer corbin corcoran corley cornelius cornett cornish corwin
  cottrell couch coulter council counts courtney covington cowart coy crabtree craddock craft crain cramer crandall crawley
  creech crenshaw crews crisp crittenden crocker crockett cromer cromwell crook crouch crow crowder crowe crowell crowley
  crum crump cullen culpepper culver currie cushman custer cutler dabney dailey daly dandridge danforth darden darling
  daughtry davies dawkins deal deaton dees dehart delaney dellinger dempsey denham denney denning dennison denson denton
  devine dewitt dick dickens dickinson dickson dill dinkins dobbins dobbs dobson dodd dodge dolan donahue donnelly dooley
  doss dotson doty dougherty douglass dowd dowdy dowell downey downing draper drew driscoll driver drummond dubose duckett
  duggan dukes dunaway dunbar dunham dunlap dunning durant durden dutton duvall dwyer dye dykes eagle earl early earnest
  easley eason easter easton echols eddy edgar edmonds edmondson elder eldridge elkins ellington elliot ellison elmore elrod
  ely emery epps erwin etheridge eubanks ewing ezell fagan faircloth fairley falk fannin farr farrar farris faulk fears
  felton fenton ferrell finney fite fitzpatrick fletcher flood flora flowers fogle foley folsom forrest forsyth fortner
  fortune foss fountain frady fraley franks freeland friend fulcher fulton funderburk furr gable gaddis gaddy gainey
  galbraith gale gann gant garland garvey gaskins gatlin gay gibbons gibbs giddens gifford gilchrist giles gillespie gilley
  gilliam gillis gilmore gilreath gladney gleason goad goddard godfrey godwin goff goforth golding goode goodrich goodson
  gore gorman goss grace grady grainger greer gregg gresham grice grier griggs grimm grissom groves grubbs guest guinn gunn
  gunter guthrie hackett hadley hagan hager haggard haley hallman halsey hamby hamer hamlin hammer hammock hammonds hampton
  hand hankins hanks hanley hannon hardaway hardee harding hardison hardwick hargrove harkins harlan harley harlow
  harrington hartley haskins hassell hatch hatfield hathaway hawley haywood head heard hearn heath heaton hedrick heller
  helms hemphill hendricks henley hennessy herndon herring hewitt hickey hickman higgins high hightower hilliard hilton
  hines hinson hitchcock hobson hogg holbrook holcomb holden holley holliday hollingsworth hollis holly holman honeycutt
  hood hooker hooks hope horner hoskins hough houghton houser howe howland hubbard huddleston hudgins huggins hull hulsey
  humphreys hunnicutt huntley hurd hutchins hutto hyatt inman ingle irby irvin irving isaacs isbell ivey ivy jacks jameson
  jamison jarrell jarrett jeffcoat jefferies jeffers jeffries jernigan jessup jett jewell jobe jolly joiner joyner judd
  justice justus kaiser kearney keaton keel keen keene kellogg kendall kenney kessler keyes kilgore killian kimball kimble
  kincaid kinder kinney kinsey kirkland kirkpatrick kitchens kittrell knowles kyle lacey lackey ladd laird lamar lancaster
  landers laney langford lanier lankford lanham larkin lassiter latham lauderdale lawler layton lea leake leblanc ledbetter
  ledford lemon lemons lester lightfoot liles lilly lindley link linton lipscomb lively lloyd locke lockhart lockwood loftin
  lomax london loper lord lott lovelace lovell lovett lowry loy luck lumpkin lunsford lusk lyle lyles lyman lynn lyon mabry
  mackey madison magee mahaffey mahan maloney manley manning mansfield maples marcum marlow marlowe marr martindale mashburn
  masters mathis mattingly mauldin maxey mayberry mayes mayfield mayhew mayo mcabee mcadams mcafee mcallister mcalpine
  mccabe mccain mccallum mccarter mccartney mcclellan mcclendon mcclure mccollum mccord mccracken mccrary mccray mccurdy
  mccutcheon mcdermott mcdonough mcdougal mcdowell mcelroy mcfadden mcfarland mcghee mcgill mcgovern mcgowan mcgrath mcgraw
  mcgregor mchugh mcintyre mckenna mckenzie mckinley mcknight mcleod mcmanus mcmillan mcmillen mcmullen mcnair mcnally
  mcneal mcneil mcneill mcqueen mcrae mcwilliams meade means mears medley meeks meredith merrill messer metcalf milam
  millard millen milligan milner mims minor mixon moffett mohr monk montague moorman morehead moreland morrell morse morton
  moseley mosley mott motley moultrie mount mowery moyer mullen mundy murdock musgrove myrick nall nance napier neely neff
  nelms nesbitt nettles newberry newby newcomb newell newkirk newsome nicholson nix nixon noel nolen northcutt norwood
  nowell nugent nunn nunnally oakes oakley odell ogden ogle oldham olsen omalley oneil oquinn orr osborn otis overby
  overstreet overton owen owensby padgett page painter pannell pardue parham parish parks parnell parr parrish parrott
  parsons partain partridge paulk peacock peebles pegram pendergrass pendleton penn penny pepper perdue person petty phelps
  philips pickens pickett pike pilgrim pinckney pinkston pinson piper pitman pitts plummer poe poindexter polk pool posey
  potts powe prather prescott presley prewitt prince pritchard pritchett proctor prosser puckett pugh pullen purcell purdy
  purvis putnam quarles queen radford ragland ragsdale rainey raines ralston ramsey randall randolph ransom rasmussen
  rawlings rawls rayburn raymond read reagan reaves redd redden redding redmond reece register renfro richey rickman ridley
  rigsby rinehart ritchie ritter rivers robb roberson robinette robins rodgers roe roper rountree rouse rowan rowell roy
  royal royster rucker rudd ruff russ rutherford rutledge ryals sadler sales salter sanborn sanderson sandlin sands sanford
  sapp sasser satterfield saxon sayers scales scarborough schofield scroggins scruggs seals searcy sears seay segars self
  sellers sessions settle sewell seymour shackelford shaffer shank shanks sharpe shaver shearer sheffield shelby shell
  shelley shepard sheridan sherman sherrill shields shipley shipman shirley shoemaker shuler shumate sides sikes simms
  simons singletary singleton sisk skaggs skelton slade slaughter smalley smallwood smart snead sneed snipes snow snowden
  sommers sorrell southerland southern sowell spain spear spears speed speer spence spicer spikes spivey spradlin spratt
  spring sprouse spruill stacy staley stallings stamey stamper stancil standley stanfield stanford stanton staples stapleton
  starling starnes starr steadman stedman steed stegall sterling stevenson steward stiles stillwell stinson stoner storey
  stovall strange stratton street stringer strong stroud stuart stubbs stuckey sturgeon sturgis styles suggs summerlin
  sumner sumter sutherland swain swann sweat swift swinney sykes talbot tallman tapp tarver tatum teague temple templeton
  thacker tharp thigpen thomason thornton thorpe thrasher threatt thurman thurmond tibbs tidwell tillery tilley tillman
  timmons tindall tinsley tipton tolbert toler tolliver tomlinson toney tooley tracy trammell treadwell tremblay trent
  trimble triplett trotter trout truitt tubbs tuck tuggle turnbull turney tuttle twitty tyner tyson upchurch upshaw upton
  usher utley varner veal venable vernon vick vickers vines vinson waddell wadsworth waggoner waite wakefield walden waldron
  wall waller walling walters warden warner warrick washburn watt waugh weathers weatherford webster welborn weldon welsh
  wentworth westbrook weston whalen whaley wharton whatley wheat wheaton whitcomb whitehurst whitfield whitlock whitman
  whitmore whitney whitt whittaker whitten whittington wicker wilburn wilkes wilkinson willard willey willingham willoughby
  wills wimberly winchester windham wingate winn winslow winstead winston witt womack woodall woodard woodruff woodson
  woodward woody wooten word worley worrell worthington worthy wray wren wylie wynn yancey yarborough yarbrough yeager
  youngblood yount`,
  // (more Hispanic and Latino, Portuguese and Brazilian, Filipino)
  `abreu acuna aguirre alarcon alcala alfaro almanza almonte alonso altamirano amador anaya angulo aranda araya arce arenas
  arevalo arias arredondo arriaga arroyo avalos baca balderas banuelos barba barragan barraza barrera barrientos barrios
  becerra benavides benitez bermudez bernal blanco bravo briones bustamante bustos caballero cabello cadena calvo camacho
  camarillo canales candelaria cano cantu carbajal cardenas cardona carmona carranza carrasco casas casillas castellanos
  cazares ceballos cedillo celis cerda chacon chapa chavarria coronado corral corrales correa cortes cuellar cuevas curiel
  davila dejesus delacruz delarosa delatorre delossantos duarte enriquez escalante escobedo esparza espinosa esquivel
  fajardo felix fierro frias gallardo gamboa garay garza gaytan godinez granados guajardo guardado guerra guevara guillen
  haro hidalgo hinojosa huerta hurtado iglesias jaramillo jasso leal ledesma leyva limon loera longoria lugo macias madrid
  madrigal magana mancilla manzano marin marrero marroquin mata mateo matos medrano melendez mena meraz meza miramontes
  mireles mondragon montalvo montanez montano montemayor montenegro muniz murillo najera naranjo narvaez navarrete nieto
  nieves noriega ocampo ojeda olivares olivas olivo olvera ornelas orta osorio otero padron palacios palomino pantoja
  paredes parra pastrana paz pedraza peralta perales perea pichardo pizarro plascencia polanco ponce portillo puente quezada
  quintana quintanilla quintero quiroz rangel razo renteria reyna rico rincon rivas rodarte roldan rolon romo rosado rosas
  ruelas saavedra saenz salas salcedo salgado samaniego sanabria santana santillan sauceda saucedo segovia segura sepulveda
  serna solano solorzano soria sotelo suarez tafoya tamayo tapia tellez tijerina toledo tovar trejo trevino ulloa urbina
  uribe urias valadez valdivia valle vallejo valverde vanegas varela vela velasco venegas vera verdugo vergara vidal viera
  villa villagomez villalobos villasenor villegas zapata zaragoza zarate zavala zepeda abrantes alves amaral antunes azevedo
  barros bastos batista bezerra borges braga brandao cabral caldeira carneiro castilho coelho cordeiro coutinho cunha dantas
  esteves falcao farias figueiredo freitas furtado gaspar goulart guimaraes lacerda lemos lopes macedo magalhaes maia
  marques martins meireles melo moraes morais moreira mota nogueira novaes nunes paiva peixoto pimentel pinheiro queiroz
  rabelo reis resende rezende sampaio seixas siqueira soares tavares valente vasconcelos veloso viana xavier abad abalos
  agbayani alcantara andaya arcilla bacani balagtas belmonte bernardo buenaventura capistrano catapang concepcion custodio
  dacanay dalisay delmundo delosreyes dimaculangan domingo esguerra estrella evangelista francisco galang gatchalian gonzaga
  ilagan javier lacson lagman laurel legaspi macaraeg magbanua magsaysay malabanan mangubat marcos mariano nepomuceno
  pangilinan panganiban pascual quiambao salvador samson sarmiento soriano`,
  // (more European: German, Jewish, Dutch, Scandinavian, Italian, French, Polish, Czech, Russian, Ukrainian, Greek,
  // Armenian)
  `albrecht bachmann barth baumann bergmann bischoff bohm brenner busch dietrich dorn ebert eckert engel ernst franke
  friedrich fuchs gerber graf gunther haas hauser heinrich herrmann hesse hofmann kirchner konig kraft kraus kuhn lorenz
  ludwig maier meier moller otto pohl sauer schaefer schmid scholz schreiber schroder schubert schulte schumacher schuster
  schwab seidel sommer steiner thiel vogel vogt wolff einstein goldstein bernstein rubinstein epstein feinstein finkelstein
  lowenstein rothstein silverstein weinstein wasserman silverman goldman lieberman schulman altman fishman glickman kleinman
  lehman perlman rosenberg weinberg steinberg ginsberg rosenthal blumenthal lowenthal lieber levin levitt lerner kahn
  rosenfeld sachs segal siegel singer sternberg strauss weinberger wexler bosch brouwer dijkstra hendriks jansen koster
  postma timmermans vermeulen wouters vandam vanderberg vandijk andersson berglund bergstrom carlsson dahl engstrom eriksson
  forsberg gustafsson hagen hakansson halvorsen haugen holm isaksen jakobsen johansen johansson karlsson larsen larsson
  lindberg lindgren lindqvist lindstrom lund lundberg lundgren magnusson nielsen nilsen nilsson nordstrom pedersen persson
  petersen sandberg sorensen strand sundberg svensson thorsen wahl amato barone basile bellini benedetti bernardi bianco
  bonanno caputo carbone cardinale castelli cattaneo conte damico deangelis derosa desimone falcone farina ferraro ferri
  fiore gatti genovese grasso lombardo lucchese macchi marchetti mazza messina monti morelli napoli negri palumbo parisi
  pellegrini piazza pirelli porcelli puccini rizzi rossetti sala salerno sanna sartori silvestri sorrentino testa tedesco
  valenti volpe zanetti arnaud aubert benoit bertrand boucher bouchard bourgeois brun caron carpentier colin denis dufour
  dumas dupuis fabre fleury gagnon gauthier gerard gillet guillaume joly lacroix leclerc lefevre legrand lemaire leroux
  marchand martel masson mathieu mercier meunier michaud morel olivier paris perrin petit picard poirier renard renaud rey
  richard robert roche roussel roux simon thibault adamczyk baran bielski borkowski czarnecki dudek gorski grabowski
  jablonski jasinski kaczmarek kalinowski kowalewski kozak krol kubiak majewski malinowski marciniak michalski nowakowski
  olszewski pawlak pawlowski piotrowski sadowski sikora sobczak stepien szewczyk tomaszewski urbanski walczak wieczorek wilk
  wojciechowski wrobel wysocki zajac zawadzki dvorak horak kovar kral kucera marek novak novotny pokorny prochazka svoboda
  vesely abramov alekseev andreev antonov baranov belov bogdanov borisov chernov dmitriev egorov fedorov frolov gusev
  ignatov ilyin kiselev komarov korolev kovalev krylov kuzmin lebedev makarov medvedev mikhailov nikitin orlov osipov
  pavlenko romanov semenov sergeev sidorov solovyov stepanov tarasov titov vasiliev vinogradov vorobyov yakovlev zaitsev
  zakharov boyko hrytsenko kovalchuk kravets lysenko marchenko melnyk moroz oliynyk polishchuk savchenko shevchuk tkachenko
  tkachuk yurchenko antonopoulos christodoulou dimitriou georgiadis karagiannis konstantinou makris nikolaidis oikonomou
  pappas papadakis papageorgiou stavropoulos vlahos abrahamian avetisyan babayan grigoryan hakobyan harutyunyan karapetyan
  khachatryan manukyan mkrtchyan petrosyan sargsyan`,
  // (more South Asian, Pakistani, Arabic, Persian, Turkish, Nigerian, Ghanaian, Ethiopian, Kenyan, Haitian, Jamaican)
  `agarwal ahuja arora bajaj bansal bhatia bhatt chakraborty chandra chauhan chawla chopra dutta dubey gandhi garg goel goyal
  iyengar jain jha kapoor kaur khanna kohli krishnan kulkarni malhotra mishra mittal modi naidu narayan pandey pandit parekh
  prasad rajan ramachandran raman saxena sethi shetty shukla sinha srinivasan subramanian tiwari trivedi varma verma yadav
  abbasi akbar alam ali anwar ashraf aziz baig bashir butt chaudhry farooq ghani hameed haq hashmi iqbal jamil javed kazmi
  mahmood masood mughal nawaz qadir rashid raza riaz saeed shafi sharif siddique syed tariq usman zaidi abdullah abdelrahman
  alhassan amin aoun asfour awad azar bakr barakat bitar daher farah fares ghanem habib hadid hakim halabi hamad hamdi
  hassan hussein issa jaber jabbour kassem khalil khalifa kouri maalouf maroun masri mouawad nassar nasr nassif qasim rizk
  sabbagh saad sabra said salem salib sayegh shaheen shammas suleiman tannous wakim yassin younes zayed afshar alavi amini
  bahrami ebrahimi esfahani farahani ghasemi hashemi jafari kazemi khani mousavi moradi nouri rezaei sadeghi salehi shirazi
  tehrani zamani acar arslan aslan aksoy bulut cakir dogan erdogan guler gunes kara karaca kilic koc korkmaz kurt ozdemir
  ozkan polat simsek tekin tas turan yavuz yildirim abiodun adeleke adeniyi adewale adeyemo afolabi agbaje ajayi akande
  akinola akinyemi alade babatunde bello chukwu egwu ekwueme emenike ibekwe ihejirika ilori iwu nnamdi nwachukwu nwankwo obi
  odukoya ogbonna ogunbiyi ojo okoro okonjo okoye oladipo olawale oyelaran addo adjei agyeman amoah ampofo ansah antwi
  asamoah boakye danquah darko donkor frimpong gyamfi kuffour kyei nkrumah ofori oppong quaye sarpong tetteh abebe alemayehu
  assefa ayele berhane demissie desta gebre gebremariam getachew hailu kassa mekonnen mengistu negash tadesse tefera tekle
  wondimu worku yohannes kamau kariuki kimani kiplagat koech maina mutua mwangi njoroge njuguna ochieng odhiambo omondi
  onyango otieno wafula wanjiru alexis augustin bastien beauvoir belizaire bellegarde cadet celestin charlemagne desrosiers
  dorvil florestal jeanbaptiste jeanlouis lafontant lamothe louissaint metellus pierrelouis saintfleur toussaint valcourt
  brissett dacosta gayle hylton mcfarlane nembhard sinclair walcott whyte`,
];

// Given names of Hungary, where the family name comes first (round 21): a full name whose last word is one ("Simon
// Zoltán", "Balázs Péter", "Gáspár Katalin", "Bogdán Eszter") is written family name first, so its first word is their
// family name and it gets no name. HUNGARIAN's are Hungarian however they're typed; HUNGARIAN_ACCENTED's only with their
// accents, being other people's given or family names without them (Peter, Adam, Maria, Eva, Robert, Nora, Marta,
// Julia; Gabor as in Zsa Zsa Gabor, Gaspar, Bogdan, Sandor, Kalman, Marton, Szilard as in Leo Szilard, Lukacs, Gellert)
//   Round 22 (finding 1): written out to Hungary's common given names, men's and women's and the short forms people go
// by (Gyuri, Józsi, Zsuzsi), about three hundred: "Simon András", "Simon György", "Simon Antal", "Simon Márta" were greeted
// "Simon". A spelling without its accents counts only when it isn't a common given name elsewhere too (Andras, Gyorgy,
// Antal count; Peter, Maria, Eva, Robert, Nora don't), as round 21 had it; names Hungarians share with everyone, accents
// and all (Anna, Linda, Viktor, Erika, Gabriella, Rita, Norbert, Patrik, Simon), aren't here: "Simon Rita" says nothing
const HUNGARIAN = `Zoltán László Balázs István Ferenc Tibor Csaba Imre Lajos Géza Gyula Dezső Ernő Jenő Lőrinc Miklós Mihály
Tamás Zsolt Levente Bence Ákos Botond Barnabás Bálint Gergely Gergő Huba Ödön Szabolcs Tivadar Vilmos Zsigmond Andor Árpád
Benedek Elemér Endre Győző János József Károly Kornél Lóránt Nándor Sebestyén Zalán Attila Katalin Eszter Erzsébet Zsófia
Ilona Anikó Csilla Edit Emese Enikő Gizella Gyöngyi Hajnalka Ibolya Ildikó Irén Judit Kinga Krisztina Lilla Magdolna Margit
Orsolya Piroska Réka Rozália Szilvia Tímea Zsuzsanna Zsuzsa Boglárka Borbála Dorottya Etelka Jolán Szabina Teréz Virág
Zsanett
András György Antal Adorján Aladár Álmos Ambrus Barna Bendegúz Benett Bertalan Bulcsú Csanád Domonkos Ede Elek Előd Frigyes
Gedeon Gusztáv Gyárfás Hunor Ignác Illés Jakab Kelemen Kende Keve Kolos Koppány Krisztofer Lehel Loránd Marcell Mátyás
Menyhért Miksa Mózes Nikolasz Örs Oszkár Pongrác Rajmund Rezső Salamon Sebő Szilveszter Tihamér Vajk Vazul Vencel Vendel
Zsombor Gyuri Pisti Jancsi Józsi Feri Zoli Misi Sanyi Karcsi Tibi Zsolti Matyi Robi Csabi Peti Andris Lajcsi Pityu Jóska
Ferkó Palkó
Ágota Abigél Adrienn Anasztázia Anett Aranka Bernadett Bianka Boróka Csenge Dalma Dorina Dorka Edina Emőke Evelin Fanni
Fruzsina Gyöngyvér Hajna Hanga Ilka Írisz Izabella Jusztina Kamilla Kincső Kitti Klotild Kriszta Lenke Lujza Mariann Matild
Mercédesz Mirtill Nelli Nikolett Panna Rebeka Sarolta Szende Szidónia Szonja Tekla Terézia Vanda Vanessza Villő Zelma Zita
Zsófi Zsóka Zsuzsi Erzsi Juci Bözsi Bori Panni Eszti Kriszti Szilvi Ági`;
const HUNGARIAN_ACCENTED = `Péter Pál Ádám Mária Éva Dániel Dávid Márk Máté Áron Ottó Gáspár Bogdán Gábor Sándor Dénes Kálmán Márton
Szilárd Ágnes Beáta Dóra Klára Tünde Béla Krisztián Richárd
Ábel Ábrahám Adrián Alfréd Ármin Artúr Aurél Benjámin Bernát Donát Dorián Fábián Flórián Gellért Hugó Iván Jácint Jónás
Kristóf Lázár Lénárd Lukács Márió Márkus Medárd Milán Móric Nimród Olivér Róbert Sámuel Tóbiás Tódor Zénó
Adél Alíz Amália Angéla Annamária Antónia Cecília Diána Emília Flóra Gertrúd Gréta Hédi Jázmin Júlia Kornélia Léna Liliána
Lívia Lúcia Margó Márta Mónika Natália Noémi Nóra Renáta Rózsa Sára Stefánia Valéria Viktória Évi Móni Nóri
Brúnó Ráhel`;
//   Round 23 (finding 5: 72 of the tester's 265 common Hungarian names weren't here, "Simon Csongor", "Ádám Zselyke" and
// "Dávid Hedvig" greeted by the family name): Hungary's own names that were missing added to the two lists above, and
// the common modern ones (Boldizsár, Bíborka, Lotti, Szófia). Hungarians give many names everyone gives, spelt the same
// (Martin, Albert, Kevin, Erika, Rita, Laura, Anna): those are HUNGARIAN_SHARED's. On their own they say nothing ("Jordan
// Martin", "Steve Martin" are greeted), but after one of Hungary's family names that's a given name too (HUNGARIAN_FAMILY:
// Simon, Albert, Ádám, Dávid, Fábián...) they're as Hungarian as the rest: "Simon Rita", "Ádám Erika", "Albert Martin" are
// written family name first (the lead's rule 1, Hungary being a people who write the family name first, and rule 5's
// "all 72"). This replaces round 22's "Simon Rita says nothing"
const HUNGARIAN_MORE = `Csongor Zente Bátor Bónis Hedvig Zselyke Szofi Lilien Zorka Janka Ivett Kati Kata Rozi Marcsi Szandra
Boldizsár Bíborka Lotti Szófia Etele Örkény Ajtony Bodza Bogi`;
// (written as everyone writes them, accents and all where others have them too: Zoé, Félix, Olívia, Míra. The plain
// spellings of the accented names above, "Peter", "Robert", "Maria", still say nothing, as round 22 had it: "Simon
// Peter" is Simon)
const HUNGARIAN_SHARED = `Vince Erik Rudolf Arnold Albert Viktor Patrik Roland Norbert Martin Dominik Noel Alex Kevin Emil
Valentin Julianna Marianna Melinda Brigitta Henrietta Nikoletta Klaudia Bettina Juli Andi Niki Ervin Viola Andrea Erika
Anita Gabriella Rita Vera Laura Luca Hanna Lili Bella Mira Maja Liza Petra Barbara Veronika Alexandra Vivien Tamara Regina
Johanna Zoé Félix Olívia Míra Anna Emma Lara Lia Linda Nina Kiara Simon`;
//   Round 24 (finding 4b: "Gábor Rita", "Ábrahám Anna", "Jordán Erika" were greeted): Hungary's family names that are
// given names too written out from what Hungarian family names are (a father's given name became one: Gábor, István,
// Ferenc, János, Lajos, Tibor and the rest), the last lines below
// Hungary's common family names (round 23): one that's a given name too, written first before any of Hungary's given names
// (the shared ones too), is the family name ("Simon Rita", "Albert Ildikó Erika"). With its accents, as Hungarians write
// it; one whose plain spelling is someone else's given name counts only with them ("Adam Rita" is Adam, "Ádám Rita" no name)
const HUNGARIAN_FAMILY = `Nagy Kovács Tóth Szabó Horváth Varga Kiss Molnár Németh Farkas Balogh Papp Takács Juhász Lakatos
Mészáros Oláh Simon Rácz Fekete Szilágyi Török Fehér Balázs Gál Kis Szűcs Kocsis Orsós Pintér Fodor Szalai Sipos Magyar
Lukács Gulyás Bíró Király Katona László Jakab Bogdán Balog Sándor Boros Fazekas Kelemen Antal Somogyi Orosz Fülöp Veres
Budai Vincze Vince Hegedűs Deák Pap Bálint Pál Illés Vörös Szőke Fábián Vass Lengyel Bodnár Hajdu Halász Jónás Máté
Székely Gáspár Dudás Kozma Pásztor Bakos Sárközi Dénes Virág Major Orbán Barta Benkő Hegyi Albert Ádám Dávid Dániel Péter
Sámuel Ábel Márk Márton Miklós Mihály Imre Benedek Kristóf Tóbiás Lázár Gergely Tamás Ambrus Elek Sebestyén Vida Erdei
Erdős Kun Csonka Kardos Csizmadia Vámos Kálmán Mátyás Jenei Bencze Barna Huszár Rigó Szekeres Lőrincz Ferenczi Kerekes
Bognár Bartos Kozák Ágoston Bárány Márkus Dobos Tamási Gergely Zsigmond Barabás
Gábor Ábrahám Jordán István Ottó Attila Csaba Iván Ferenc András Béla Bence Bertalan Boldizsár Demeter Dezső Domokos Domonkos
Ede Endre Ernő Géza Gellért György Gyula János Jenő József Károly Lajos Lénárd Lőrinc Móric Mózes Nándor Pongrác Salamon
Szilveszter Tibor Tivadar Tódor Vendel Vilmos Zakariás Ignác Kolos Dömötör Gyárfás Rókus Ákos Barnabás Hajnal Rózsa`;

// Women's names, and names women go by as often as men (round 21), for a greeting after a woman's courtesy title ("Mrs.
// Amy Ames" is Amy; "Mrs. John Ames", a wife written by her husband's name, is no name). Positive evidence: a name not
// marked here is no name after one. ENGLISH_WOMEN above whole (the names both go by, Taylor's and Jordan's kind, among
// them), these from the other lists, and none of WOMEN_NOT: a woman's name in one place and a man's in another is no
// evidence ("Madame Jean Dupont" is Jean Dupont's wife as "Mrs. John Ames" is John Ames's; Andrea and Simone are Italian
// men, Ali an Arabic one, Jan a Dutch one, Jaime a Spanish one, Hoa Hòa without its accent)
const WOMEN_NOT = `Ali Andrea Ariel Chandra Jaime Jan Janis Jean Jocelyn Kay Michele Patrice Simone Toni Nikita Ira Asa Rosario Noa
Rana Miki Hoa Inge`;
const WOMEN = `Jordan Riley Rowan Drew Alex Charlie Chris Terry Parker Finley Kennedy Stevie Sidney Blake
Mary-Kate Jo-Ann Jo-Anne Lee-Ann Leigh-Ann Ann-Marie Anne-Marie Mary-Jane Mary-Anne Mary-Ellen Mary-Lou Mary-Jo Sarah-Jane
Lisa-Marie Mary-Beth Betty-Jo Billie-Jo Bobbie-Jo Lou-Ann
Aaliyah Aisha Amani Amina Ayana Ayanna Ayesha Bria Chanel Chantal Chante Ciara Cierra Deja Dejah Demetria Dionne Dominique
Ebony Eboni Ernestine Essie Fatima Imani Iesha Jada Jaila Jalisa Jamila Jazmin Jazmine Kayla Keisha Keshia Kiana Kiara
Kierra LaDonna LaKeisha Lakisha LaShonda LaTanya LaTasha Latisha LaToya LaTonya Lavonne Leandra Lekisha Marquita Monae
Monique Nia Niesha Nya Raven Rashida Roshanda Shakira Shalonda Shameka Shamika Shanae Shaneka Shanelle Shanice Shaniqua
Shanita Shante Shardae Sharonda Shayla Sheree Sherika Shirelle Shonda Shontae Tameka Tamika Tamia Tanesha Tanisha Tasha
Tia Tiana Tierra Tomeka Tyesha Tyra Yolanda Yvette Zakiya Zaria La'Tonya Ta'Nisha
Abril Adriana Agustina Aida Alejandra Alessandra Alicia Alma Alondra Amalia Amparo Ana Anabel Analía Angélica Antonia
Araceli Ariadna Bárbara Beatriz Blanca Brenda Camila Candelaria Carina Carla Carlota Carmela Carmen Carolina Catalina
Cecilia Celia Claudia Concepción Consuelo Cristina Dalia Daniela Débora Dolores Elena Elisa Elsa Elvira Erika Esmeralda
Esperanza Estefanía Estela Eva Evelia Fabiola Fernanda Flor Francisca Gabriela Gisela Gloria Graciela Guadalupe Helena
Hilda Inés Ingrid Irene Iris Irma Isabel Itzel Jazmín Josefina Juana Juliana Leticia Lidia Liliana Lizbeth Lorena Lourdes
Lucía Luciana Luisa Lupe Luz Macarena Magdalena Manuela Marcela Margarita María Mariana Maribel Maricela Marisol Marta
Martina Mercedes Micaela Milagros Mireya Mónica Nadia Natalia Nayeli Noemí Norma Olga Paloma Paola Paula Paulina Perla
Pilar Raquel Rebeca Renata Rocío Rosa Rosalía Rosario Rosaura Sandra Sara Selena Silvia Socorro Sofía Soledad Susana
Teresa Valentina Valeria Vanesa Verónica Virginia Viviana Ximena Xiomara Yadira Yesenia Yolanda Yuliana Zoila Abigaíl
Yaretzi Dulce Itzayana Jimena Regina Romina Monserrat Montserrat Rafaela Bianca Larissa Letícia Vitória Isadora Heloísa
Conceição Graça Fátima Thaís Tatiana Priscila Glória Maite Itziar Aitana Ainhoa Nerea Begoña Arantxa Montse Núria
Gal\u00B7la Mireia
Marie-Claire Marie-Ange Marie-Louise Marie-Thérèse Marie-Josée Marie-France Marie-Hélène Rose-Marie Marie-Rose
Marie-Carmelle Rose Guerda Jocelyne Kettly Lunise Micheline Nadège Roselande Yolette Shauna Wislande Wideline Widline
Carline Darline Mirlande Myrlande Nathalie Sabine Sherline Pascale Yvrose Altagracia Yokasta Yahaira Yanira Yaritza Yesica
Wanda Nilda Migdalia Maritza Marilú Lisette Lizette Iliana Ivelisse Haydée Gisselle Krystal Natalie Tricia Shellyann
Stacy-Ann Kerry-Ann Sherry-Ann Joy-Ann Mary-Ann Kimone Shawna Yanique Tashana Tishauna
Adaeze Adanna Adaora Adeline Adenike Aderonke Adesuwa Bisi Bukola Busola Chiamaka Chidinma Chimamanda Chinelo Chinwe Chioma
Ezinne Folake Folasade Folashade Funke Funmi Funmilayo Ifeoma Ifunanya Ijeoma Kemi Lola Lolade Moji Mojisola Morenike
Nkechi Nkiruka Nneka Nnenna Ngozi Ogechi Olabisi Oluchi Oluwakemi Onyinye Sade Ugochi Wunmi Yetunde Zainab Hadiza Halima
Hauwa Maryam Abena Adjoa Adwoa Afia Afua Akosua Akua Ama Amma Efua Esi Yaa Dzifa Enyonam Esinam Adoley Korkor Aminata
Fatou Mariama Kadiatou Binta Aissatou Awa Coumba Khady Penda Seynabou Hawa Kadidia Oumou Musu Kebeh Patience Mercy Ireti
Oyinda Teniola Simisola Tiwa Tiwalade Ese Ayo Ayodele Damilola Kehinde Taiwo Temitope Tolu Tolulope Tope Toyin Yemi
Precious Blessing
Almaz Aster Eleni Feven Genet Hana Helen Hiwot Kidist Lemlem Liya Mahlet Mekdes Meron Nardos Rahel Saba Selam Semhar Senait
Tigist Tsion Yordanos Weyni Winta Achieng Akinyi Atieno Awino Adhiambo Mumbua Mwende Nafula Neema Njeri Nyokabi Wairimu
Wambui Wangari Wanjiku Wanjiru Zawadi Makena Muthoni Nyambura Fartun Hodan Ilhan Istahil Khadra Muna Nimco Sahra Ifrah
Iqra Ismahan Kaltun Sagal Ubah Warsan Yasmin Zamzam Akello Apio Aine Nakato Babirye Uwase Keza Ineza Mutesi Neza Teta
Nyandeng Achol
Aarthi Aarti Aditi Ahana Aishwarya Amita Amrita Ananya Anika Anita Anjali Anjana Ankita Anuradha Anushka Aparna Archana
Arpita Aruna Asha Bhavana Bhavna Deepa Deepika Devika Divya Durga Gayatri Geeta Gita Hema Indira Isha Jaya Jyoti Kajal
Kalpana Kamala Kavita Kavya Kiran Lakshmi Lata Madhavi Manisha Meena Meera Megha Mira Mohini Nalini Nandini Neha Nisha
Padma Pallavi Pooja Preeti Priti Priya Priyanka Puja Rachana Radha Rashmi Reena Rekha Ritu Ruchi Rupa Sangeeta Sapna
Sarita Shalini Sharmila Sheetal Shilpa Shreya Shruti Shweta Simran Sita Smita Sneha Sonal Sonali Sunita Swati Tanvi Uma
Usha Veena Vidya Zara Dhanya Hiral Kinjal Komal Krupa Nupur Parul Payal Pinal Rupal Sejal Urvi Vaishali Anaya Diya Kiara
Myra Navya Saanvi Siya Ishita Riya Shriya Trisha Bushra Hina Javeria Mahnoor Maria Mehwish Nida Rabia Sadia Saima Sana
Shazia Sidra Uzma Zoya Shirin Taslima Farzana Fahmida Jannat Mithila Shapla Tania Dilini Harini Thilini Sachini Pramila
Sabina Sanjana Sushila
Mei Ying Ling Lan Yan Xiaoyan Xiaoling Lili Yutong Xinyi Jiayi Yixuan Siyu Ruoxi Meiling Meihua Xiaohong Xiaomei Jingyi
Yiting Yuting Shuang Ying-Ying Hsin-Yi Yu-Ting Pei-Shan Shu-Fen
Aiko Akiko Ayaka Ayumi Chiyo Emi Eri Fumiko Hanako Haruka Hikari Hina Hiroko Hitomi Junko Kana Kaori Keiko Kumiko Mai Mami
Mari Mariko Masako Mayumi Megumi Michiko Midori Miho Miki Misaki Miyu Naoko Naomi Noriko Reiko Rina Sachiko Sakura Shiori
Tomoko Yoko Yoshiko Yui Yuka Yuki Yukiko Yumi Yuna Asuka Nanami
Seo-yeon Ji-eun Soo-jin Eun-ji Min-ji Ha-eun Hye-jin Ji-young Min-seo Ye-jin Soo-ah Mi-kyung Young-mi Jisoo Minji
Hanh Hoa Huong Ngoc Nhung Phuong Quynh Thao Thu Thuy Trang Uyen Vy Diep Hong Nga Nhi Oanh Trinh
Rowena Marites Maricel Lorna Analyn Rhea Imelda Corazon Teresita Rosalinda Marilou Erlinda Leonora Nenita Lolita
Charmaine Mylene Jasmin Joanne Liezl Kristine
Anong Malee Suda Kanya Kulap Sunee Thida Dewi Ayu Wati Yanti Indah Ratna Lestari Yer Nou Shoua Maiyer Maikou Thandar
Sophea Bopha Channary Chenda Kunthea Sokunthea Sreymom Chanthou Leakhena Sreyleak
Aisha Khadija Mariam Layla Leila Laila Huda Hanan Rania Salma Yasmine Amira Samira Rana Dina Lina Reem Mona Noura Abla
Asma Aya Basma Duaa Eman Ghada Hala Hiba Inas Jana Jumana Lamia Lubna Maha Maysa Mayada Najla Nawal Nisreen Rasha Rawan
Rula Safa Samar Sawsan Shaima Suha Tala Wafa Yara Zahra Zeina Zaina Behnaz Laleh Mina Nasrin Parisa Parvin Roya Soraya
Yasaman Pegah Neda Ladan Mahnaz Azadeh Bahar Golnaz Niloufar Shabnam Ziba Afsaneh Anahita Arezoo Atefeh Elham Fereshteh
Golnar Haleh Leyla Mahsa Mehrnaz Minoo Nazanin Negar Nooshin Parastoo Roxana Sahar Sepideh Setareh Shahla Simin Taraneh
Zohreh Ece Elif Emine Esra Fatma Hande Selin Zeynep Ayşe Aylin Cansu Ebru Gizem Gül Hatice Merve Melis Nihan Özge Pınar
Sevgi Tuba Yasemin Dilnoza Gulnara Nargiza Zarina Aigerim Freshta Mursal Nargis Parwin Shabana Zarghona Zarlasht
Eliana Shira Tamar Talia Yael Aviva Batya Chana Chaya Devorah Esther Leah Miriam Rivka Sarah Shoshana Tova Noa Maya Hila
Rachel Ruth Ronit Adina Ahuva Aliza Avital Ayelet Bracha Efrat Elisheva Gila Hadas Hadassah Liora Malka Meital Moriah
Nechama Orly Rena Rivkah Sigal Tali Tzipora Yaffa Yehudit Zehava Avigail Batsheva Chava Keren Liat Noga Orit Shani
Shulamit Tziona Yonit Neta Dana
Amélie Bernadette Brigitte Camille Céline Colette Delphine Élise Émilie Fabienne Florence Françoise Geneviève Hélène
Isabelle Jeanne Joëlle Josette Lucie Madeleine Manon Margaux Marguerite Martine Mathilde Mireille Odette Renée Solène
Sophie Sylvie Valérie Véronique Zoé Aurélie Clémence Éloïse Gaëlle Léa Léonie Noémie Océane Thérèse Anke Annegret Birgit
Elke Gisela Gudrun Hannelore Heidi Heike Helga Hildegard Ilse Ingeborg Karin Katja Katrin Lena Lea Margit Monika Petra
Renate Silke Susanne Ulrike Ursula Femke Lotte Sanne Anouk Inge Lieke Marieke Annalisa Annamaria Alessia Antonella Arianna
Beatrice Benedetta Chiara Federica Francesca Giorgia Giovanna Giulia Giuliana Ilaria Lucia Margherita Paola Roberta
Simona Sofia Stefania Vittoria Agnieszka Aleksandra Anna Beata Danuta Dorota Elżbieta Ewa Grażyna Halina Irena Janina
Joanna Justyna Karolina Katarzyna Krystyna Małgorzata Malgorzata Renata Urszula Zofia Zuzanna Jana Lenka Tereza Katarína
Katalin Erzsébet Zsófia Zsofia Andreea Ioana Mihaela Raluca Alyona Anastasia Anya Daria Ekaterina Galina Irina Katya
Larisa Lyudmila Nadezhda Natalya Natasha Oksana Polina Sofya Svetlana Tatyana Yana Yulia Zhanna Halyna Ivanna Olena
Yaroslava Yuliia Jelena Marija Milica Snežana Vesna Ivana Amra Emina Jasmina Selma Athena Despina Evangelia Katerina
Penelope Theodora Astrid Freya Linnea Sigrid Mette Kirsten Anneli Elin Hanna Ida Maja Malin Stina Tove Jonna Liisa Aino
Kaisa Sanna Linnéa Rūta Ruta Ilze Liene Aoife Bridget Deirdre Eileen Fiona Niamh Orla Saoirse Siobhan Sinead Sinéad
Aisling Caoimhe Eimear Grainne Maeve Muireann Nuala Oonagh Ailsa Catriona Isla Kirsty Morag Mhairi Rhona Angharad Bethan
Bronwen Cerys Gwyneth Megan Rhian Sian Siân Tegan
Abby Addy Ally Annie Barb Barbie Becca Becky Bess Bessie Billie Bobbi Bobbie Carrie Cassie Cathy Chrissie Chrissy Cindy
Connie Deb Debbie Debby Dottie Effie Ellie Em Emmy Evie Frannie Gabby Gina Ginny Gwen Hattie Jackie Jen Jenn Jenny Jessie
Jill Jo Jodie Jody Josie Judy Julie Kat Kate Kathy Katie Katy Kristy Lexi Lexie Libby Liz Liza Lizzie Lizzy Lucy Lulu
Maddie Maddy Mandy Marge Margie Mattie Meg Millie Mindy Missy Molly Nell Nellie Nikki Pam Patsy Patti Patty Peggy Penny
Polly Rosie Ruthie Sadie Sally Shelly Steph Sue Susie Suzy Tammy Tess Tina Tracy Trish Trudy Vicky Viv Winnie Bea Cece
Flo Hettie Kitty Lettie Lottie Midge Minnie Netta Nettie Trixie Wendi Pat Sandy Sammie Dani`;

// (a word as these lists key it: small letters, no accents, the letters no accent comes off made plain)
// Round 23 (finding 2: "Tien Meiling" got no name but "Tien Mei-ling" was greeted "Tien", the list having "Meiling"):
// and no hyphens, so a name is the same name joined, hyphenated or with a capital inside ("Meiling", "Mei-ling",
// "Mei-Ling", "MeiLing"; "Min-jun", "Minjun"), on the lists and as typed alike. Every look-up here goes through it
const PLAIN_LETTERS = { ø: 'o', ł: 'l', đ: 'd', ð: 'd', æ: 'ae', œ: 'oe', ß: 'ss', þ: 'th', ı: 'i', ħ: 'h', ŋ: 'n' };
const ANY_HYPHEN = /[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu;
// Round 24 (finding 2: "Tien Ch'un-hui" was greeted "Tien", "Tien Chun-hui" not, the key keeping the apostrophe): and no
// apostrophes of any kind (' and its look-alikes, the okina and the backtick among them), as it has no hyphens, on the
// lists and as typed alike: Wade-Giles writes one in "Ch'un-hui" that people leave out; "O'Neil" and "Oneil", "De'Andre"
// and "DeAndre" are one name each
const ANY_APOSTROPHE = /['`´ʹʻʼʽʾʿˈ՚׳᾿`‘’‛′‵Ꞌꞌ＇]/gu;
// (round 25: a word of plain a to z alone is its own key in small letters, as the rest would make it, at once: the lists'
// thousands of words are keyed when a greeting first asks, inside its time)
const PLAIN_AZ = /^[A-Za-z]+$/;
export const nameKey = (w) => (PLAIN_AZ.test(w) ? w.toLowerCase() : String(w).replace(ANY_APOSTROPHE, '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[øłđðæœßþıħŋ]/g, (c) => PLAIN_LETTERS[c]).replace(ANY_APOSTROPHE, '').replace(ANY_HYPHEN, ''));
// (the same with its hyphens and apostrophes kept: which of the list's spellings is the one typed, "Jo-Ann" or "Joann",
// "De'Andre" or "DeAndre")
const shapeKey = (w) => String(w).replace(ANY_APOSTROPHE, "'").normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(ANY_APOSTROPHE, "'").replace(ANY_HYPHEN, '-');

let GIVEN = null;
let FIRST = null;
let BOTH = null;
let PAIRS = null;
let CAPS = null;
let LONG = null;
let TITLED = null;
let BEFORE = null;
let GIVEN_OF = null;
let FAMILY_ANY = null;
let FAMILY_OF = null;
let SHAPES = null;
let SURNAME = null;
let HU = null;
let HU_ACC = null;
let HU_ACC_KEY = null;
let HU_SHARED = null;
let HU_FAMILY = null;
let WOMAN = null;
let ANYWHERE = null;
const words = (list) => list.split(/\s+/).filter(Boolean);
// (a word as typed, its accents kept: small letters, composed; no hyphens, round 23, and no apostrophes, round 24)
const accented = (w) => String(w).normalize('NFC').toLowerCase().replace(ANY_APOSTROPHE, '').replace(ANY_HYPHEN, '');
const hasAccent = (w) => String(w).normalize('NFKD') !== String(w).normalize('NFC');
// (Chinese family names in pinyin, each with its Wade-Giles form and its Hong Kong ones: [pinyin, wade-giles, [hong kong]])
let FORMS = null;
const chinese = () => {
  if (FORMS) return FORMS;
  const hk = new Map(words(CANTONESE_OF).map((e) => e.split(':')).map(([py, f]) => [nameKey(py), f.split(',')]));
  const syl = syllables();
  // (a family name of two syllables, "Situ", "Ouyang": each syllable)
  const wg = (py) => {
    const k = nameKey(py);
    if (syl.py.has(k)) return wgSyllable(k);
    for (let i = 1; i < k.length; i++) if (syl.py.has(k.slice(0, i)) && syl.py.has(k.slice(i))) return wgSyllable(k.slice(0, i)) + wgSyllable(k.slice(i));
    return '';
  };
  // (round 25: and Singapore's and Malaysia's, spelt by rule from each reading, STRAITS_OF)
  const straits = new Map();
  for (const e of words(STRAITS_OF)) {
    const [py, readings] = e.split(':');
    const all = straits.get(nameKey(py)) || new Set();
    for (const r of readings.split(/[/,]/).filter(Boolean)) for (const f of straitsSpellings(r)) all.add(f.charAt(0).toUpperCase() + f.slice(1));
    straits.set(nameKey(py), all);
  }
  FORMS = [...new Set(words(PINYIN_FAMILY))].map((py) => [py, wg(py), hk.get(nameKey(py)) || [], [...(straits.get(nameKey(py)) || [])]]);
  return FORMS;
};
// (a people's family names, as FAMILY_NAMES_OF writes them; the Chinese with pinyin's Wade-Giles and Hong Kong forms)
const familiesOf = (k) => (k ? words(FAMILY_NAMES_OF[k][1])
  : [...chinese().flatMap(([py, wg, hk, st]) => [py, ...(wg ? [wg] : []), ...hk, ...st]), ...words(FAMILY_NAMES_OF[0][1])]);
// The syllables, as nameKey keys them: pinyin's, Wade-Giles's (made from pinyin's), Hong Kong's, Korean names', Hepburn's morae
let SYL = null;
const syllables = () => {
  if (SYL) return SYL;
  const py = new Set();
  for (const line of PINYIN_TAKES.split('\n')) {
    const [inits, fins] = line.split(':');
    for (const i of inits ? words(inits) : ['']) for (const f of words(fins)) py.add(i + f);
  }
  const hk = new Set(words(HK_ALONE));
  for (const i of words(HK_INITIALS)) for (const f of words(HK_FINALS)) hk.add(i + f);
  const ja = new Set();
  for (const group of HEPBURN.split('|')) {
    const [inits, vowels] = group.includes(':') ? group.split(':') : ['', group];
    for (const i of inits ? words(inits) : ['']) for (const v of words(vowels)) ja.add(i + v);
  }
  const hok = new Set(words(HOKKIEN_ALONE));
  for (const i of words(HOKKIEN_INITIALS)) for (const f of words(HOKKIEN_FINALS)) hok.add(i + f);
  // (round 25: Korean's every syllable by its romanizations' rules, an initial, a vowel and a final as the rules write them
  // (koreanParts), with the written list: asked of a syllable, never written out, so it's made at once)
  const hand = new Set(words(KOREAN_SYLLABLES));
  const { initials, vowels, finals } = koreanParts();
  const alt = (xs) => [...xs].filter(Boolean).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`^(?:${alt(initials)})?(?:${alt(vowels)})(?:${alt(finals)})?$`);
  const ko = { has: (x) => hand.has(x) || re.test(x) };
  SYL = { py, wg: new Set([...py].map(wgSyllable)), hk, hok, ko, ja };
  return SYL;
};
// (two syllables of one set: written apart by a hyphen, or joined, any place the word splits; `joined` false: only apart)
const twoOf = (set, parts, joined = true) => (parts.length === 2 ? set.has(parts[0]) && set.has(parts[1])
  : joined && parts.length === 1 && [...parts[0]].some((_, i) => i > 0 && set.has(parts[0].slice(0, i)) && set.has(parts[0].slice(i))));
// (pinyin joined, as the romanization writes it: a syllable starting with a, e or o after another takes an apostrophe, so
// one written joined without it never starts there, "Xian" being one syllable, never Xi-an)
const pinyinJoined = (py, k) => [...k].some((_, i) => i > 0 && py.has(k.slice(0, i)) && py.has(k.slice(i)) && !/^[aeo]/.test(k.slice(i)));
// (how many Hepburn morae a word is, 0 when it isn't written in them: the moraic n before a consonant or at the end, a
// doubled consonant before its own, the h of a long "oh")
const morae = (k) => {
  const { ja } = syllables();
  const best = new Array(k.length + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < k.length; i++) {
    if (best[i] < 0) continue;
    const step = (n) => { best[i + n] = Math.max(best[i + n], best[i] + 1); };
    for (const n of [1, 2, 3]) if (i + n <= k.length && ja.has(k.slice(i, i + n))) step(n);
    const next = k[i + 1] || '';
    if (k[i] === 'n' && !/[aeiouy]/.test(next) && k[i - 1] !== 'n') step(1);
    else if (/[kstp]/.test(k[i]) && i > 0 && /[aeiou]/.test(k[i - 1]) && (next === k[i] || (k[i] === 't' && next === 'c'))) step(1);
    else if (k[i] === 'h' && k[i - 1] === 'o' && !/[aeiouy]/.test(next)) step(1);
  }
  return Math.max(best[k.length], 0);
};
// Each people's given-name shape, by their place in FAMILY_NAMES_OF (round 24): Chinese, one or two syllables of pinyin, of
// Wade-Giles or of Hong Kong's spellings (one romanization in one name); Japanese, two Hepburn morae or more; Korean, two of
// its names' syllables. Vietnamese, Khmer and Hmong names have no such shape: their lists alone. (Never past a name's length)
// Taiwan and Hong Kong write a given name of two syllables with a hyphen ("Shu-chuan", "Wai-keung"): joined, two
// syllables are pinyin's alone. Each shape is asked of a word as `parts`: its syllables as typed apart by hyphens, keyed)
const shapesOf = () => {
  const { py, wg, hk, hok, ko } = syllables();
  // (round 24, the lead: Hokkien, Teochew and Hakka a fourth; written apart by a hyphen, each syllable any of the four, as
  // names of two spellings are, "Ing-wen", "Yat-sen", "Chee-hwa")
  const any = new Set([...py, ...wg, ...hk, ...hok]);
  const chinese = (parts) => (parts.length === 1 ? [py, wg, hk, hok].some((set) => set.has(parts[0])) || pinyinJoined(py, parts[0]) : twoOf(any, parts));
  return [(parts) => parts.join('').length <= 14 && chinese(parts), (parts) => parts.length === 1 && parts[0].length <= 16 && morae(parts[0]) >= 2,
    (parts) => parts.join('').length <= 14 && twoOf(ko, parts), null, null, null];
};
// (a word's syllables as typed apart by hyphens, each as nameKey keys it)
const syllablesTyped = (w) => String(w).split(ANY_HYPHEN).map(nameKey).filter(Boolean);
// (words that start a family name in parts, never a given name by shape: "Jan de Vries", "Juan Dela Cruz")
const PARTICLE_KEY = /^(?:de|di|da|du|des|del|della|delle|degli|dei|dela|delos|dos|das|do|von|van|vander|der|den|ter|ten|la|le|lo|las|los|al|el|bin|bint|ibn|abu|ben|bat|st|ste|saint|mac|mc|y|e)$/;
const build = () => {
  // (each key, and every spelling the lists give it, "Joann", "JoAnn", "Jo-Ann": the first is the one shown unless the
  // typed one is written as another is)
  GIVEN = new Map();
  for (const block of NAMES) for (const n of block.split(/\s+/)) {
    if (!n) continue;
    const all = GIVEN.get(nameKey(n));
    if (!all) GIVEN.set(nameKey(n), [n]); else if (!all.includes(n)) all.push(n);
  }
  ANYWHERE = new Set(GIVEN.keys());
  for (const n of NEVER.split(/\s+/)) GIVEN.delete(nameKey(n));
  FIRST = new Set(FAMILY_FIRST_NAMES.split(/\s+/).filter(Boolean).map(nameKey));
  BOTH = new Set(TITLE_TOO.split(/\s+/).map(nameKey));
  CAPS = new Set(LETTERS_TOO.split(/\s+/).map(nameKey));
  LONG = new Set(words(TITLE_BEFORE_NAMES).map(nameKey));
  TITLED = new Set(words(TITLE_PAIRS).map((p) => p.split('_').map(nameKey).join(' ')));
  // (each family name, and the peoples it's a family name of, by their place in FAMILY_NAMES_OF; round 22: those that are
  // family names first too count, "Ming Wei", "Joe Min". Round 23: every family name of a people's that's a given name on the
  // lists and not one that always comes first, found here from FAMILY_NAMES_OF, never picked by hand. Round 24: the Chinese
  // ones with their Wade-Giles and Hong Kong forms, familiesOf; and every family name of these peoples, FAMILY_ANY)
  BEFORE = new Map();
  GIVEN_OF = FAMILY_NAMES_OF.map(([people]) => new Set(words(people).map(nameKey)));
  FAMILY_ANY = new Set();
  FAMILY_OF = FAMILY_NAMES_OF.map(() => new Set());
  FAMILY_NAMES_OF.forEach((_, k) => {
    for (const f of new Set(familiesOf(k).map(nameKey))) {
      FAMILY_ANY.add(f);
      FAMILY_OF[k].add(f);
      if (!GIVEN.has(f) || FIRST.has(f)) continue;
      BEFORE.set(f, (BEFORE.get(f) || new Set()).add(k));
    }
  });
  SHAPES = shapesOf();
  HU = new Set([...words(HUNGARIAN), ...words(HUNGARIAN_MORE)].map(nameKey));
  HU_ACC = new Set(words(HUNGARIAN_ACCENTED).map(accented));
  HU_ACC_KEY = new Set(words(HUNGARIAN_ACCENTED).map(nameKey));
  HU_SHARED = new Set(words(HUNGARIAN_SHARED).map(nameKey));
  // (Hungary's family names that are given names on the lists, as typed: with their accents, or without them only when
  // the plain spelling is no other people's given name, Bal\u00E1zs and L\u00E1szl\u00F3 being Hungarian however typed, Simon and
  // Albert having none: never "Adam", "David", "Peter", "Fabian")
  HU_FAMILY = new Set();
  for (const f of words(HUNGARIAN_FAMILY)) {
    if (!GIVEN.has(nameKey(f)) && !HU_ACC.has(accented(f))) continue;
    HU_FAMILY.add(accented(f));
    if (!hasAccent(f) || HU.has(nameKey(f))) HU_FAMILY.add(nameKey(f));
  }
  // (only given names on the lists: one taken out, NEVER's, is never a woman's name to greet either)
  WOMAN = new Set([...words(ENGLISH_WOMEN), ...words(WOMEN)].map(nameKey).filter((k) => GIVEN.has(k)));
  for (const n of words(WOMEN_NOT)) WOMAN.delete(nameKey(n));
  // (each pair, and each hyphenated name on the lists, as its two names: "jo ann" for Jo-Ann)
  PAIRS = new Map(DOUBLE.split(/\s+/).filter(Boolean).map((p) => [p.split('_').map(nameKey).join(' '), p.split('_')]));
  for (const all of GIVEN.values()) for (const n of all) { const h = n.split('-'); if (h.length === 2 && !PAIRS.has(h.map(nameKey).join(' '))) PAIRS.set(h.map(nameKey).join(' '), h); }
};

/**
 * The name as the list writes it ("deshawn" \u2192 "DeShawn"), or '' when it isn't a given name on the list. Round 23: found
 * however it's joined or hyphenated ("Mei-ling" is the list's "Meiling"); of the list's spellings of it, the one written
 * as typed ("JO-ANN" is Jo-Ann, "JOANN" Joann)
 */
export function givenName(w) {
  if (!GIVEN) build();
  const all = GIVEN.get(nameKey(w));
  if (!all) return '';
  const shape = shapeKey(w);
  return all.find((n) => shapeKey(n) === shape) || all.find((n) => n.includes('-') === shape.includes('-')) || all[0];
}
/** A word on the names lists at all, the never-greeted ones too ("Loan", "Floor"): never made a place word (round 23) */
export function onTheLists(w) {
  if (!ANYWHERE) build();
  return ANYWHERE.has(nameKey(w));
}
/** A family name that comes first ("Nguyen", "Kim", "Lee"): a full name starting with it is greeted by no name */
export function familyFirst(w) {
  if (!FIRST) build();
  return FIRST.has(nameKey(w));
}
/** A given name that's a title or an office before a name too ("Tuan", "Hakim", "ADA"): never greeted from a full name */
export function titleToo(w) {
  if (!BOTH) build();
  return BOTH.has(nameKey(w));
}
/** A given name that's an office's letters too ("ADA"): never greeted from a full name with no capitals or no small letters */
export function lettersToo(w) {
  if (!CAPS) build();
  return CAPS.has(nameKey(w));
}
/** Two given names people go by together ("Mary", "Beth"), as the list writes them, or null */
export function givenPair(a, b) {
  if (!PAIRS) build();
  return PAIRS.get(`${nameKey(a)} ${nameKey(b)}`) || null;
}
/**
 * A woman's name, or one women go by as often as men (round 21: "Amy", "Jordan", "Mary-Kate"; never "John", "Jean"): the
 * only names greeted after a woman's courtesy title. A hyphenated name not on the list is one when both its names are
 */
export function womansName(w) {
  if (!WOMAN) build();
  if (WOMAN.has(nameKey(w))) return true;
  const h = String(w).split('-');
  return h.length === 2 && h.every((x) => WOMAN.has(nameKey(x)));
}
/** A given name that's a title before a whole name as often ("Malik", "Earl"): greeted only before a family name alone */
export function titleBeforeNames(w) {
  if (!LONG) build();
  return LONG.has(nameKey(w));
}
/** Two words that are a title together ("Ida Bagus", "Ida Ayu"): no name from the first */
export function titlePair(a, b) {
  if (!TITLED) build();
  return TITLED.has(`${nameKey(a)} ${nameKey(b)}`);
}
/**
 * A family name that comes first before this given name of its people's own ("Sam" before "Rainsy", "Tien" before
 * "Yu-ting"). Round 24 (finding 3: "Kai Daisuke", "Ann Woo-jin", "Bo Xiaohua", "Tung Wai-keung" were greeted, those given
 * names missing from the lists): or before a word with their given names' shape (shapesOf), unless it's a family name the
 * lists know, one that always comes first, one of these peoples' that's no given name on the lists, or a common family name
 * of any people's ("Yuki Kato", "Kai Chen", "Ken Masuda", "Juan Luna", "Ken Johnson" are given name first), or the first
 * word of a family name in parts ("Jan de Vries")
 */
export function familyFirstBefore(a, b) {
  if (!BEFORE) build();
  const peoples = BEFORE.get(nameKey(a));
  if (!peoples) return false;
  const k = nameKey(b);
  if ([...peoples].some((p) => GIVEN_OF[p].has(k))) return true;
  // (a known family name beats a shape: one always first, one of these peoples' that's nobody's given name, or a common
  // family name of any people's, SURNAMES, "Juan Luna", "Ken Johnson", "Aida Romero")
  if (!SURNAME) SURNAME = new Set(SURNAMES.flatMap(words).map(nameKey));
  if (PARTICLE_KEY.test(k) || FIRST.has(k) || (FAMILY_ANY.has(k) && !ANYWHERE.has(k)) || SURNAME.has(k)) return false;
  const parts = syllablesTyped(b);
  return parts.length <= 2 && [...peoples].some((p) => !!SHAPES[p]?.(parts));
}
/**
 * Round 25 (findings 1 to 3, the lead's rule, the root: "Ann Hye-kyo", "Sam Thida" and "Soo Wei Ming" were greeted by
 * their family name, the given names missing from the lists and from the shapes): after a family name some people write
 * first (any of the tables: Chinese in every romanization, Japanese, Korean, Vietnamese, Khmer, Hmong, Hungarian), the
 * first word is greeted only on positive evidence that the name is written given name first here, so the given-name
 * lists and the shapes are never what stands between a family name and a greeting. The evidence: the last word is a
 * family name of a people who write the given name first (SURNAMES, or two of them joined by a hyphen, "Smith-Jones"),
 * no word after the first is a given name of that people's own (or of Hungary's, or a married name by a husband's), and
 * any word between is a given name on the lists, an initial or another such family name ("Sam David Johnson", "Juan
 * Lopez Garcia"); or a family name in parts follows, its first word a particle that's none of that people's own syllables
 * or family names ("Jan de Vries", "Juan Dela Cruz"). Anything else, a word the lists don't know or one hyphenated as
 * those peoples write a given name ("Hye-kyo", "Joong-ki"), gets no name: a missed name is fine. → true: no name
 */
export function familyFirstUnsure(ws, { pair = false } = {}) {
  if (!BEFORE) build();
  if (!ws || ws.length < 2) return false;
  const peoples = [...(BEFORE.get(nameKey(ws[0])) || [])];
  const hu = hungarianFamily(ws[0]);
  if (!peoples.length && !hu) return false;
  // (two given names people go by together, then a family name: that family name the evidence, "Thanh Huong Ames")
  if (pair) return !givenFirstFamily(ws[ws.length - 1]);
  const rest = ws.slice(1);
  const cased = /\p{Lu}/u.test(ws.join('')) && /\p{Ll}/u.test(ws.join(''));
  const theirs = (w) => peoples.some((p) => GIVEN_OF[p].has(nameKey(w))) || (hu && (givenFamilyFirst(w) || marriedName(w)));
  if (rest.some(theirs)) return true;
  // (a word of that people's own: a given name, a family name, or one of their syllables or a given name's shape)
  const own = (w) => peoples.some((p) => GIVEN_OF[p].has(nameKey(w)) || FAMILY_OF[p].has(nameKey(w)) || !!SHAPES[p]?.(syllablesTyped(w)));
  // (a particle starting a family name in parts: never one of that people's family names, nor Vietnamese Văn or Thị; one
  // of their syllables only before a word that's none of theirs, "Jan de Vries" but never "Kai De Hua")
  const particle = (w, next) => {
    const k = nameKey(w);
    // (Văn and Thị, the middle words of most Vietnamese names: "van" a particle only as Dutch writes it, in small letters
    // in a name with capitals, "Jan van Dijk"; never "Sam Van An")
    if (k === 'thi' || (k === 'van' && !(cased && w === 'van'))) return false;
    if (!PARTICLE_KEY.test(k) || peoples.some((p) => FAMILY_OF[p].has(k))) return false;
    return !peoples.some((p) => ownSyllable(p, k)) || (!!next && !own(next));
  };
  if (rest.length >= 2 && particle(rest[0], rest[1])) return false;
  // (two given names people go by together, "Juan Carlos": the first is a given name, written first)
  if (rest.length === 1 && givenPair(ws[0], rest[0])) return false;
  if (!givenFirstFamily(rest[rest.length - 1])) return true;
  return !rest.slice(0, -1).every((w, i) => /^\p{L}\.?$/u.test(w) || particle(w, rest[i + 1]) || PARTICLE_KEY.test(nameKey(w)) && !peoples.some((p) => FAMILY_OF[p].has(nameKey(w)))
    || !!givenName(w) || givenFirstFamily(w));
}
// (a family name of a people who write the given name first: SURNAMES', or two of them joined by a hyphen)
const givenFirstFamily = (w) => {
  if (!SURNAME) SURNAME = new Set(SURNAMES.flatMap(words).map(nameKey));
  const parts = String(w).split(ANY_HYPHEN).map(nameKey).filter(Boolean);
  return parts.length >= 1 && parts.length <= 2 && parts.every((k) => SURNAME.has(k));
};
// (a word that's one of a people's own syllables, as their romanizations write them: Chinese, Japanese, Korean; and
// Vietnamese Văn, the middle word of most men's names, the Vietnamese having no syllables here)
const ownSyllable = (p, k) => {
  const s = syllables();
  return p === 0 ? [s.py, s.wg, s.hk, s.hok].some((x) => x.has(k)) : p === 1 ? s.ja.has(k) : p === 2 ? s.ko.has(k) : p === 3 && k === 'van';
};
/** (for the tests: each Chinese family name in pinyin, its Wade-Giles form made from it, its Hong Kong forms) */
export function chineseForms() { return chinese().map(([py, wg, hk, st]) => ({ pinyin: py, wadeGiles: wg, hongKong: [...hk], straits: [...st] })); }
/** (for the tests: the ways Singapore and Malaysia spell a reading, round 25) */
export const straitsSpelt = (r) => straitsSpellings(nameKey(r));
/** (for the tests: whether a word has a people's given-name shape, "chinese", "japanese" or "korean") */
export function givenShape(people, w) {
  if (!BEFORE) build();
  const k = ['chinese', 'japanese', 'korean'].indexOf(people);
  const parts = syllablesTyped(w);
  return k >= 0 && parts.length <= 2 && !!SHAPES[k](parts);
}
/**
 * A given name of Hungary's, where the family name comes first ("Zoltán", "Péter"; round 23: the names Hungarians share
 * with everyone too, "Martin", "Rita", HUNGARIAN_SHARED's). On its own, one of the shared ones says nothing (hungarianOrder)
 */
export function givenFamilyFirst(w) {
  if (!HU) build();
  return HU.has(nameKey(w)) || HU_ACC.has(accented(w)) || HU_SHARED.has(nameKey(w));
}
// (Hungary's own: a name only Hungarians give, or give so spelt, "Zoltán", "Csongor", "Ádám")
const hungarianOwn = (w) => HU.has(nameKey(w)) || HU_ACC.has(accented(w));
/**
 * A married Hungarian woman's name by her husband's (round 23, finding 3): his given name and "-né", "Zoltánné" (Mrs. Zoltán
 * ...), "Péterné", "Lászlóné". Without the accent after one of Hungary's own men's names, by the spelling-neutral key (round
 * 24: "Zoltanne", "Péterne", "Peterne"), and round 25 after any man's given name ("Martinne"), never "Jeanne", "Joanne",
 * "Marianne" or "Thorne"
 */
export function marriedName(w) {
  if (!HU) build();
  const a = String(w).normalize('NFC').toLowerCase();
  if ([...a].length < 5) return false;
  if (a.endsWith('n\u00E9')) { const base = a.slice(0, -2); return !!givenName(base) || givenFamilyFirst(base) || HU_ACC_KEY.has(nameKey(base)); }
  // (round 24, finding 4a: "Simon Péterne" was greeted "Simon", only HUNGARIAN's names counting before an unaccented "-ne";
  // now any of Hungary's own men's names, accented ones too, by the spelling-neutral key, "Péterne", "Peterne", "Gáborne".
  // Never a woman's name, a husband's being the name it's made from: "Juliane", "Mariane" are names of their own)
  if (!a.endsWith('ne')) return false;
  // (round 25, finding 4, round 24's rule: after any man's given name, Hungary's own or one Hungarians share with everyone,
  // "Martinne", "Albertne", "Viktorne", "Norbertne", "Ádámne", by the spelling-neutral key; never a word that's a given name
  // itself, "Joanne", "Jeanne", "Lynne", nor a family name of a people who write it last, "Thorne", "Browne", "Payne", "Leone")
  if (GIVEN.has(nameKey(a)) || givenFirstFamily(a)) return false;
  const base = nameKey(a.slice(0, -2));
  return (HU.has(base) || HU_ACC_KEY.has(base) || HU_SHARED.has(base) || GIVEN.has(base)) && !WOMAN.has(base);
}
/** One of Hungary's family names that's a given name too, as typed ("Simon", "Albert", "Ádám", "Balazs"; never "Adam") */
export function hungarianFamily(w) {
  if (!HU_FAMILY) build();
  return HU_FAMILY.has(accented(w)) || HU_FAMILY.has(nameKey(w));
}
/**
 * A full name's words (titles and letters set apart) written family name first as Hungarians write it (rounds 21 to 23):
 * a word after the first that's one of Hungary's own given names ("Simon Zoltán", round 23 any of them, not only the last:
 * "Simon Katalin Anna") or a married name by her husband's ("Simon Zoltánné"); or one of Hungary's family names that's a
 * given name too, first, before any of Hungary's given names, the shared ones too ("Simon Rita", "Albert Ildikó Erika")
 */
export function hungarianOrder(ws) {
  if (!HU) build();
  if (!ws || ws.length < 2) return false;
  const rest = ws.slice(1);
  return rest.some((w) => hungarianOwn(w) || marriedName(w)) || (hungarianFamily(ws[0]) && rest.some(givenFamilyFirst));
}
// (how many Korean syllables the rules and the written list make, for the tests and the report)
const koreanCount = () => {
  const { initials, vowels, finals } = koreanParts();
  const all = new Set(words(KOREAN_SYLLABLES));
  for (const i of initials) for (const v of vowels) for (const f of finals) all.add(i + v + f);
  return all.size;
};
/** How many names the lists hold (for the tests and the report) */
export function listSizes() {
  if (!GIVEN) build();
  const keys = (list) => new Set(words(list).map(nameKey)).size;
  return { given: GIVEN.size, pairs: PAIRS.size, familyFirst: FIRST.size, titleToo: BOTH.size + CAPS.size, women: WOMAN.size,
    titleBeforeNames: LONG.size, titlePairs: TITLED.size, hungarian: HU.size + HU_ACC.size + HU_SHARED.size, familyFirstBefore: BEFORE.size,
    hungarianOwn: HU.size + HU_ACC.size, hungarianShared: HU_SHARED.size, hungarianFamily: words(HUNGARIAN_FAMILY).length,
    chinese: keys(CHINESE), japanese: keys(JAPANESE), korean: keys(KOREAN), vietnamese: keys(VIETNAMESE), khmer: keys(KHMER), hmong: keys(HMONG),
    // (round 24: the syllables the shapes are made of, and the Chinese family names with their made forms)
    pinyin: syllables().py.size, wadeGiles: syllables().wg.size, hongKong: syllables().hk.size, koreanSyllables: koreanCount(), morae: syllables().ja.size, hokkien: syllables().hok.size,
    chineseFamily: new Set(familiesOf(0).map(nameKey)).size };
}
/** (for the tests: every name rounds 21 to 23's lists mark, as written, so each can be checked to be a given name on the lists) */
export function markedNames() {
  if (!BEFORE) build();
  const peoples = ['chinese', 'japanese', 'korean', 'vietnamese', 'khmer', 'hmong'];
  return { women: words(WOMEN), womenNot: words(WOMEN_NOT), titleBeforeNames: words(TITLE_BEFORE_NAMES),
    titlePairs: words(TITLE_PAIRS).map((p) => p.split('_')),
    // (round 23: found from each people's family names, FAMILY_NAMES_OF, not written by hand)
    // (round 24: the Chinese with the Wade-Giles and Hong Kong forms build makes from the pinyin, familiesOf)
    familyFirstBefore: [...new Set(FAMILY_NAMES_OF.flatMap((_, k) => familiesOf(k)).filter((w) => BEFORE.has(nameKey(w))))],
    familyNamesOf: Object.fromEntries(FAMILY_NAMES_OF.map((_, k) => [peoples[k], familiesOf(k)])),
    givenNamesOf: Object.fromEntries(FAMILY_NAMES_OF.map(([people], k) => [peoples[k], words(people)])),
    hungarian: [...words(HUNGARIAN), ...words(HUNGARIAN_MORE)], hungarianAccented: words(HUNGARIAN_ACCENTED),
    hungarianShared: words(HUNGARIAN_SHARED), hungarianFamily: words(HUNGARIAN_FAMILY),
    // (round 24: the common family names of every people's, that beat a shape)
    commonFamilyNames: [...new Set(SURNAMES.flatMap(words))] };
}
