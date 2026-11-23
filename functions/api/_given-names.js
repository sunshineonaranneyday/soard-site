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
Xiaomei Xiaowei Jingyi Yiting Yuting Shuang Ying-Ying Chia-Hao Chih-Ming Hsin-Yi Yu-Ting Wei-Ming Pei-Shan Shu-Fen`;
const JAPANESE = `Akira Aiko Akiko Ayaka Ayumi Chiaki Chiyo Daichi Daiki Emi Eri Fumiko Hana Hanako Haruka Haruki Haruto Hideki
Hideo Hikari Hina Hiro Hiroko Hiroshi Hiroto Hitomi Ichiro Junko Kaito Kana Kaori Kazuki Kazuo Keiko Kenji Kenta Kenzo
Kiyoshi Koji Kumiko Mai Makoto Mami Mari Mariko Masako Masao Masato Mayumi Megumi Michiko Midori Miho Miki Minoru Misaki
Miyu Naoki Naoko Naomi Natsuki Noriko Osamu Reiko Ren Riku Rin Rina Ryo Ryota Sachiko Sakura Satoshi Shigeru Shinji
Shiori Shota Sora Sota Takashi Takumi Takeshi Taro Tetsuya Tomoko Toshiro Yoko Yoshi Yoshiko Yoshiro Yui Yuka Yuki
Yukiko Yumi Yuna Yusuke Yuto Kei Kenichi Shunsuke Seiji Tatsuya Hayato Asuka Aoi Nanami`;
const KOREAN = `Min-jun Seo-yeon Ji-hoon Ji-woo Hyun-woo Jae-won Sung-min Ji-eun Soo-jin Eun-ji Min-ji Ha-eun Yeon-woo Jun-ho
Dong-hyun Hye-jin Ji-young Joon-ho Min-seo Seo-jun Do-yoon Ye-jin Soo-ah Hyun-jin Jae-hyun Sang-woo Young-ho Mi-kyung
Kyung-soo Joon Jae Seung Hyun Sang Min Eun Soo Jin Ji Hye Sun Yeon Jun Young-mi Myung Chul Jiho Jisoo Jiwoo Minji Seojin
Yuna`;
const VIETNAMESE = `An Anh Bao Binh Chau Chi Cuong Dung Duc Duy Giang Hai Hanh Hieu Hoa Hung Huong Huy Khanh Khoa Kim Lan Linh
Loan Minh Ngoc Nhung Phuong Phuc Quang Quoc Quynh Tam Thanh Thao Thu Thuy Tien Trang Trung Tuan Tung Uyen Viet Vy Xuan
Yen Bich Diep Hang Hien Hong Khoi Lien Long Mai My Nga Nhi Oanh Phong Sang Tai Thi Thien Tho Thuan Toan Trinh Truc Tu Vinh`;
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
Leakhena Sreyleak Sophorn`;
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
const FAMILY_FIRST_BEFORE = [
  // (Chinese, in pinyin and in Taiwan's Wade-Giles (Tien, Jen): family names there that are given names too)
  [CHINESE, `Ying Jian Zhen Jing Qing Ming Bo Ping Kai Yong Shu Shan Rui Qiang Zhi Lou Jie Hai Kou Tien Jen`],
  // (Japanese: Kai, Yūki, Aida, Miki and Sakura are family names there, and given names here)
  [JAPANESE, `Kai Yuki Aida Miki Sakura`],
  [KOREAN, `Joe Yong`],
  // (Vietnamese: Thành, Vĩnh, Trang, Lục, Hoa, Quang)
  [VIETNAMESE, `Thanh Vinh Trang Luc Hoa Quang`],
  [KHMER, `Sam Em Nou`],
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
Lívia Lúcia Margó Márta Mónika Natália Noémi Nóra Renáta Rózsa Sára Stefánia Valéria Viktória Évi Móni Nóri`;

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
const PLAIN_LETTERS = { ø: 'o', ł: 'l', đ: 'd', ð: 'd', æ: 'ae', œ: 'oe', ß: 'ss', þ: 'th', ı: 'i', ħ: 'h', ŋ: 'n' };
export const nameKey = (w) => String(w).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[øłđðæœßþıħŋ]/g, (c) => PLAIN_LETTERS[c]).replace(/[\u2019\u02BC]/g, "'");

let GIVEN = null;
let FIRST = null;
let BOTH = null;
let PAIRS = null;
let CAPS = null;
let LONG = null;
let TITLED = null;
let BEFORE = null;
let HU = null;
let HU_ACC = null;
let WOMAN = null;
const words = (list) => list.split(/\s+/).filter(Boolean);
// (a word as typed, its accents kept: small letters, composed, a curly apostrophe made straight)
const accented = (w) => String(w).normalize('NFC').toLowerCase().replace(/[\u2019\u02BC]/g, "'");
const build = () => {
  GIVEN = new Map();
  for (const block of NAMES) for (const n of block.split(/\s+/)) if (n && !GIVEN.has(nameKey(n))) GIVEN.set(nameKey(n), n);
  for (const n of NEVER.split(/\s+/)) GIVEN.delete(nameKey(n));
  FIRST = new Set(FAMILY_FIRST_NAMES.split(/\s+/).filter(Boolean).map(nameKey));
  BOTH = new Set(TITLE_TOO.split(/\s+/).map(nameKey));
  CAPS = new Set(LETTERS_TOO.split(/\s+/).map(nameKey));
  LONG = new Set(words(TITLE_BEFORE_NAMES).map(nameKey));
  TITLED = new Set(words(TITLE_PAIRS).map((p) => p.split('_').map(nameKey).join(' ')));
  // (each family name, and the given names of every people it's a family name of; round 22: those that are family names
  // first too count, "Ming Wei", "Joe Min")
  BEFORE = new Map();
  for (const [people, fams] of FAMILY_FIRST_BEFORE) {
    for (const f of words(fams).map(nameKey)) {
      const own = BEFORE.get(f) || new Set();
      for (const g of words(people)) own.add(nameKey(g));
      BEFORE.set(f, own);
    }
  }
  HU = new Set(words(HUNGARIAN).map(nameKey));
  HU_ACC = new Set(words(HUNGARIAN_ACCENTED).map(accented));
  // (only given names on the lists: one taken out, NEVER's, is never a woman's name to greet either)
  WOMAN = new Set([...words(ENGLISH_WOMEN), ...words(WOMEN)].map(nameKey).filter((k) => GIVEN.has(k)));
  for (const n of words(WOMEN_NOT)) WOMAN.delete(nameKey(n));
  // (each pair, and each hyphenated name on the lists, as its two names: "jo ann" for Jo-Ann)
  PAIRS = new Map(DOUBLE.split(/\s+/).filter(Boolean).map((p) => [p.split('_').map(nameKey).join(' '), p.split('_')]));
  for (const n of GIVEN.values()) { const h = n.split('-'); if (h.length === 2 && !PAIRS.has(h.map(nameKey).join(' '))) PAIRS.set(h.map(nameKey).join(' '), h); }
};

/** The name as the list writes it ("deshawn" \u2192 "DeShawn"), or '' when it isn't a given name on the list */
export function givenName(w) {
  if (!GIVEN) build();
  return GIVEN.get(nameKey(w)) || '';
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
/** A family name that comes first before this given name of its people's own ("Sam" before "Rainsy", "Tien" before "Yu-ting") */
export function familyFirstBefore(a, b) {
  if (!BEFORE) build();
  return !!BEFORE.get(nameKey(a))?.has(nameKey(b));
}
/** A given name of a people who write the family name first, Hungary's ("Zoltán", "Péter"): a full name ending in one has its family name first */
export function givenFamilyFirst(w) {
  if (!HU) build();
  return HU.has(nameKey(w)) || HU_ACC.has(accented(w));
}
/** How many names the lists hold (for the tests and the report) */
export function listSizes() {
  if (!GIVEN) build();
  return { given: GIVEN.size, pairs: PAIRS.size, familyFirst: FIRST.size, titleToo: BOTH.size + CAPS.size, women: WOMAN.size,
    titleBeforeNames: LONG.size, titlePairs: TITLED.size, hungarian: HU.size + HU_ACC.size, familyFirstBefore: BEFORE.size };
}
/** (for the tests: every name rounds 21 and 22's lists mark, as written, so each can be checked to be a given name on the lists) */
export function markedNames() {
  return { women: words(WOMEN), womenNot: words(WOMEN_NOT), titleBeforeNames: words(TITLE_BEFORE_NAMES),
    titlePairs: words(TITLE_PAIRS).map((p) => p.split('_')), familyFirstBefore: [...new Set(FAMILY_FIRST_BEFORE.flatMap(([, fams]) => words(fams)))],
    hungarian: words(HUNGARIAN), hungarianAccented: words(HUNGARIAN_ACCENTED) };
}
