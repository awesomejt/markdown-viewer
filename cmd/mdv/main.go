package main

var version = "dev"

func main() {
	println(versionString())
}

func versionString() string {
	return "mdv " + version
}
