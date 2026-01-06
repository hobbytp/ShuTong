开发前，保证openspec目录在.gitignore里面没有ignored.

```
对该功能创建openspec change proposal。
```
```
对该功能在openspec里面进行归档。
```

虽然这部分feature我们已经开发的差不多了，但是我还是希望创建相应的openspec change proposal。然后你根据已经开发好的功能把相应的tasks给mark上。



```text
请对该方案和代码进行review，看看是否有错漏和可以改进的地方。包括功能，非功能(perf, robust,resilience, failure path handling etc)，测试（TDD），可观测性（关键操作添加metrics和logging，长时间操作加入时间记录等）等方面。
```

```text
请对docs下的designs/下的设计文档，functions/下的功能描述文档进行更新，保证详细，清晰，设计图要涵盖主要算法，逻辑和流程图，功能描述要让用户容易看懂，另外，检查README.md是否需要更新。
```
```text
在feature开发过程中，遇到过的设计问题（设计错误，遗漏）和代码和测试上遇到的问题和这些问题是如何解决的，都总结写入到docs/lesson_and_learn/<feature_name>.md里面。
```



Antigravity会生成
plan, implementation_plan, tasks,workthrough,lesson_and_learn.